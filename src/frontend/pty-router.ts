import type { ClientMessage, ServerMessage } from "../lib/xtmux/types";
import type { TerminalSize } from "./Terminal";

/**
 * The socket multiplexer's routing core (§7.4), with no React in it.
 *
 * v1 had one `terminalRef` and one flat message queue, because a client showed
 * exactly one terminal. v2 shows several at once — the agent terminal plus any
 * shell tabs, possibly in split groups — so the thing that has to be per-PTY is
 * the routing: a `data` frame belongs to the one terminal bound to its ptyId
 * and to no other.
 *
 * Kept as a plain object rather than living inside the provider because the
 * isolation guarantee is the whole point and it is worth being able to test
 * without mounting two terminals in a DOM.
 */

/** What a terminal must offer to be routed to. Deliberately the narrow half of
 * `TerminalHandle`: routing needs to deliver frames, nothing more. */
export interface PtySink {
  handleMessage: (message: ServerMessage) => void;
}

/** Non-PTY traffic and connection lifecycle, for the contexts above this one:
 * the task list, activity, notifications. */
export interface SocketSubscriber {
  onMessage?: (message: ServerMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

/** Whether a server message is addressed to one terminal. */
export function ptyIdOf(message: ServerMessage): string | null {
  switch (message.type) {
    case "data":
    case "restore":
    case "resize":
    case "exit":
    case "attached":
      return message.ptyId;
    // The only frame that is addressed sometimes. The server names the PTY that
    // provoked a refusal wherever there is one — a stale `attach`, a keystroke
    // to a terminal this client no longer holds — and leaves it off for
    // failures that are client-wide. So an explanation lands in the grid that
    // asked for it, and only the genuinely client-wide ones fan out.
    case "error":
      return message.ptyId ?? null;
    default:
      return null;
  }
}

export interface PtyRouter {
  /** Bind a terminal to a ptyId and drain anything that arrived before it
   * mounted. Returns the unbind. Registration is routing only — it does not put
   * an `attach` on the wire, because *when* to attach is the tab host's
   * decision and it needs a measured size to make it. */
  registerTerminal: (ptyId: string, sink: PtySink) => () => void;
  /** Ask the server for this PTY's stream. */
  attach: (ptyId: string, size: TerminalSize | null) => void;
  /** Give a PTY back. Omitting the id gives back every PTY this client holds,
   * which is what a task teardown wants. */
  detach: (ptyId?: string) => void;
  sendInput: (ptyId: string, data: string) => void;
  /**
   * Report this client's view of a PTY's size, or null for "no longer
   * measuring".
   *
   * Null is what a terminal in a hidden tab sends. Size negotiation is
   * smallest-wins across every attached client, so a hidden tab that kept
   * reporting its stale layout would hold the whole task down to a grid nobody
   * is looking at — while it still has to receive output, so detaching is not
   * the answer either.
   */
  resize: (ptyId: string, size: TerminalSize | null) => void;
  /** Server messages that are not addressed to a PTY, plus connect and
   * disconnect. Returns the unsubscribe. */
  subscribe: (subscriber: SocketSubscriber) => () => void;
  /** Called by the socket for every frame. */
  route: (message: ServerMessage) => void;
  handleConnect: () => void;
  handleDisconnect: () => void;
  /** Introspection, for tests and for the provider's own assertions. */
  isAttached: (ptyId: string) => boolean;
  queueDepth: (ptyId: string) => number;
}

export function createPtyRouter(send: (message: ClientMessage) => void): PtyRouter {
  const sinks = new Map<string, PtySink>();
  // Frames that arrived before their terminal mounted. Keyed by ptyId rather
  // than pooled, so replaying one terminal's backlog cannot paint into
  // another's grid — which is exactly what the single v1 queue risked once a
  // client could hold more than one PTY.
  const queues = new Map<string, ServerMessage[]>();
  // PTYs we have asked for. Anything arriving for a ptyId not in here is
  // dropped rather than queued: it is output for a terminal we gave back, and
  // it is what bounds the queue — we only ever hold frames for streams we asked
  // for and intend to render.
  const attached = new Set<string>();
  const subscribers = new Set<SocketSubscriber>();

  function fanOut(message: ServerMessage) {
    for (const subscriber of [...subscribers]) subscriber.onMessage?.(message);
  }

  return {
    registerTerminal(ptyId, sink) {
      sinks.set(ptyId, sink);
      const queued = queues.get(ptyId);
      if (queued) {
        queues.delete(ptyId);
        for (const message of queued) sink.handleMessage(message);
      }
      return () => {
        // Only if it is still ours: a ptyId can be re-registered by the next
        // terminal before this one's cleanup runs, and clearing then would
        // leave the live terminal unrouted.
        if (sinks.get(ptyId) === sink) sinks.delete(ptyId);
      };
    },

    attach(ptyId, size) {
      attached.add(ptyId);
      send({ type: "attach", ptyId, ...(size ? { cols: size.cols, rows: size.rows } : {}) });
    },

    detach(ptyId) {
      // One predicate for both halves. Branching on `=== undefined` locally and
      // on truthiness for the wire would make an empty-string ptyId drop one
      // entry here while telling the server to hand back every PTY — and the
      // client would go on believing it held them.
      if (ptyId === undefined) {
        attached.clear();
        queues.clear();
        send({ type: "detach" });
        return;
      }
      attached.delete(ptyId);
      queues.delete(ptyId);
      send({ type: "detach", ptyId });
    },

    sendInput(ptyId, data) {
      send({ type: "input", ptyId, data });
    },

    resize(ptyId, size) {
      send({ type: "resize", ptyId, cols: size?.cols ?? null, rows: size?.rows ?? null });
    },

    subscribe(subscriber) {
      subscribers.add(subscriber);
      return () => {
        subscribers.delete(subscriber);
      };
    },

    route(message) {
      const ptyId = ptyIdOf(message);
      if (ptyId === null) {
        fanOut(message);
        return;
      }

      // `attached` is the server's answer to our own attach, so it is addressed
      // to a PTY but is not terminal output: the layer above needs it to learn
      // which task the PTY belongs to, and the terminal needs it to go live.
      if (message.type === "attached") fanOut(message);

      if (!attached.has(ptyId)) return;

      const sink = sinks.get(ptyId);
      if (sink) {
        sink.handleMessage(message);
        return;
      }
      const queue = queues.get(ptyId);
      if (queue) queue.push(message);
      else queues.set(ptyId, [message]);
    },

    handleConnect() {
      // The server forgot this client when the socket closed, so nothing we
      // held is held any more. Cleared before the subscribers run, so whoever
      // re-attaches does it against an empty slate rather than against ptyIds a
      // daemon restart has already invalidated.
      attached.clear();
      queues.clear();
      for (const subscriber of [...subscribers]) subscriber.onConnect?.();
    },

    handleDisconnect() {
      for (const subscriber of [...subscribers]) subscriber.onDisconnect?.();
    },

    isAttached: (ptyId) => attached.has(ptyId),
    queueDepth: (ptyId) => queues.get(ptyId)?.length ?? 0,
  };
}
