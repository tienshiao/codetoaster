import { test, expect } from "bun:test";
import { createPtyRouter, ptyIdOf } from "./pty-router";
import type { PtyRouter, PtySink, SocketSubscriber } from "./pty-router";
import type { ClientMessage, ServerMessage, TaskInfo } from "../lib/xtmux/types";

// ── router under test, with the wire recorded ───────────────────────────────

interface Wired {
  router: PtyRouter;
  sent: ClientMessage[];
}

function makeRouter(): Wired {
  const sent: ClientMessage[] = [];
  return { router: createPtyRouter((message) => sent.push(message)), sent };
}

// ── sink and subscriber recorders ───────────────────────────────────────────

interface RecordingSink extends PtySink {
  received: ServerMessage[];
}

function makeSink(): RecordingSink {
  const received: ServerMessage[] = [];
  return { received, handleMessage: (message) => received.push(message) };
}

interface RecordingSubscriber extends SocketSubscriber {
  received: ServerMessage[];
  connects: number;
  disconnects: number;
}

function makeSubscriber(): RecordingSubscriber {
  const subscriber: RecordingSubscriber = {
    received: [],
    connects: 0,
    disconnects: 0,
    onMessage: (message) => subscriber.received.push(message),
    onConnect: () => {
      subscriber.connects += 1;
    },
    onDisconnect: () => {
      subscriber.disconnects += 1;
    },
  };
  return subscriber;
}

/** The payload strings a sink saw, which is what stream isolation reads off. */
function dataOf(sink: RecordingSink): string[] {
  return sink.received.flatMap((m) => (m.type === "data" ? [m.data] : []));
}

// ── server message factories ────────────────────────────────────────────────

const data = (ptyId: string, payload: string): ServerMessage => ({
  type: "data",
  ptyId,
  data: payload,
});

const restore = (ptyId: string, payload = ""): ServerMessage => ({
  type: "restore",
  ptyId,
  data: payload,
  size: { cols: 80, rows: 24 },
  cursor: { x: 0, y: 0 },
  cursorHidden: false,
  mouseEncoding: "",
});

const resized = (ptyId: string, cols = 80, rows = 24): ServerMessage => ({
  type: "resize",
  ptyId,
  cols,
  rows,
});

const exited = (ptyId: string, code = 0): ServerMessage => ({ type: "exit", ptyId, code });

const attachedMsg = (ptyId: string, taskId = "task-1"): ServerMessage => ({
  type: "attached",
  ptyId,
  taskId,
});

const errorFor = (ptyId: string, message = "Terminal not found"): ServerMessage => ({
  type: "error",
  message,
  ptyId,
});

const task = (id: string): TaskInfo => ({
  id,
  projectId: "general",
  ptyId: null,
  title: id,
  titleSource: "derived",
  terminalTitle: "",
  agentState: "idle",
  lastMessage: null,
  lifecycle: "live",
  clientCount: 0,
  size: { cols: 80, rows: 24 },
  createdAt: 0,
  lastActiveAt: 0,
  exited: false,
  hasNotification: false,
});

// ── stream isolation (AC #1) ────────────────────────────────────────────────

test("two terminals on different ptyIds receive only their own data", () => {
  const { router } = makeRouter();
  const a = makeSink();
  const b = makeSink();
  router.attach("pty-a", null);
  router.attach("pty-b", null);
  router.registerTerminal("pty-a", a);
  router.registerTerminal("pty-b", b);

  router.route(data("pty-a", "for a"));
  router.route(data("pty-b", "for b"));

  expect(dataOf(a)).toEqual(["for a"]);
  expect(dataOf(b)).toEqual(["for b"]);
});

test("every PTY-addressed frame type reaches only its own terminal", () => {
  const { router } = makeRouter();
  const a = makeSink();
  const b = makeSink();
  router.attach("pty-a", null);
  router.attach("pty-b", null);
  router.registerTerminal("pty-a", a);
  router.registerTerminal("pty-b", b);

  for (const frame of [
    data("pty-a", "out"),
    restore("pty-a", "snapshot"),
    resized("pty-a", 100, 40),
    exited("pty-a", 3),
  ]) {
    router.route(frame);
  }

  expect(a.received.map((m) => m.type)).toEqual(["data", "restore", "resize", "exit"]);
  expect(b.received).toEqual([]);

  // And the same in the other direction, so neither side is merely the quiet one.
  router.route(data("pty-b", "out"));
  router.route(exited("pty-b", 1));
  expect(b.received.map((m) => m.type)).toEqual(["data", "exit"]);
  expect(a.received).toHaveLength(4);
});

// ── per-ptyId queueing (AC #2) ──────────────────────────────────────────────

test("frames arriving before a terminal mounts are queued per ptyId", () => {
  const { router } = makeRouter();
  router.attach("pty-a", null);
  router.attach("pty-b", null);

  router.route(data("pty-a", "a1"));
  router.route(data("pty-a", "a2"));
  router.route(data("pty-b", "b1"));

  expect(router.queueDepth("pty-a")).toBe(2);
  expect(router.queueDepth("pty-b")).toBe(1);
});

test("registering a terminal replays only its own backlog, in order", () => {
  const { router } = makeRouter();
  router.attach("pty-a", null);
  router.attach("pty-b", null);
  router.route(restore("pty-a", "snapshot"));
  router.route(data("pty-a", "a1"));
  router.route(data("pty-a", "a2"));
  router.route(data("pty-b", "b1"));

  const a = makeSink();
  router.registerTerminal("pty-a", a);
  expect(a.received.map((m) => m.type)).toEqual(["restore", "data", "data"]);
  expect(dataOf(a)).toEqual(["a1", "a2"]);
  expect(router.queueDepth("pty-a")).toBe(0);
  // The other terminal's backlog is untouched by the first one's drain.
  expect(router.queueDepth("pty-b")).toBe(1);

  const b = makeSink();
  router.registerTerminal("pty-b", b);
  expect(dataOf(b)).toEqual(["b1"]);
  expect(router.queueDepth("pty-b")).toBe(0);
  expect(a.received).toHaveLength(3);
});

test("frames arriving after registration go straight to the sink and are not queued", () => {
  const { router } = makeRouter();
  const a = makeSink();
  router.attach("pty-a", null);
  router.registerTerminal("pty-a", a);

  router.route(data("pty-a", "live"));

  expect(dataOf(a)).toEqual(["live"]);
  expect(router.queueDepth("pty-a")).toBe(0);
});

// ── a hidden tab (AC #3) ────────────────────────────────────────────────────

test("a hidden tab reports no size and stays attached", () => {
  const { router, sent } = makeRouter();
  router.attach("pty-a", { cols: 80, rows: 24 });

  router.resize("pty-a", null);

  expect(sent.at(-1)).toEqual({ type: "resize", ptyId: "pty-a", cols: null, rows: null });
  expect(router.isAttached("pty-a")).toBe(true);
});

test("a visible tab reports its measured size", () => {
  const { router, sent } = makeRouter();
  router.resize("pty-a", { cols: 120, rows: 40 });
  expect(sent).toEqual([{ type: "resize", ptyId: "pty-a", cols: 120, rows: 40 }]);
});

// ── closing a tab (AC #4) ───────────────────────────────────────────────────

test("the unregister returned by registerTerminal stops delivery", () => {
  const { router } = makeRouter();
  const a = makeSink();
  router.attach("pty-a", null);
  const unregister = router.registerTerminal("pty-a", a);

  unregister();
  router.route(data("pty-a", "after"));

  expect(a.received).toEqual([]);
  // Still attached, so the frame is queued rather than dropped.
  expect(router.queueDepth("pty-a")).toBe(1);
});

test("detach(ptyId) puts a detach on the wire and clears only that ptyId", () => {
  const { router, sent } = makeRouter();
  router.attach("pty-a", null);
  router.attach("pty-b", null);
  router.route(data("pty-a", "a1"));
  router.route(data("pty-b", "b1"));

  router.detach("pty-a");

  expect(sent.at(-1)).toEqual({ type: "detach", ptyId: "pty-a" });
  expect(router.isAttached("pty-a")).toBe(false);
  expect(router.queueDepth("pty-a")).toBe(0);
  expect(router.isAttached("pty-b")).toBe(true);
  expect(router.queueDepth("pty-b")).toBe(1);
});

test("detach() with no ptyId gives back every PTY", () => {
  const { router, sent } = makeRouter();
  router.attach("pty-a", null);
  router.attach("pty-b", null);
  router.route(data("pty-a", "a1"));
  router.route(data("pty-b", "b1"));

  router.detach();

  expect(sent.at(-1)).toEqual({ type: "detach" });
  expect(router.isAttached("pty-a")).toBe(false);
  expect(router.isAttached("pty-b")).toBe(false);
  expect(router.queueDepth("pty-a")).toBe(0);
  expect(router.queueDepth("pty-b")).toBe(0);
});

// ── what bounds the queue ───────────────────────────────────────────────────

test("frames for a ptyId that was never attached are dropped, not queued", () => {
  const { router } = makeRouter();
  router.route(data("pty-a", "a1"));
  router.route(restore("pty-a"));
  router.route(exited("pty-a"));
  expect(router.queueDepth("pty-a")).toBe(0);
});

test("frames for a detached ptyId are dropped even with a sink still registered", () => {
  const { router } = makeRouter();
  const a = makeSink();
  router.attach("pty-a", null);
  router.registerTerminal("pty-a", a);
  router.detach("pty-a");

  router.route(data("pty-a", "late"));

  expect(a.received).toEqual([]);
  expect(router.queueDepth("pty-a")).toBe(0);
});

// ── `attached` is both addressed and fanned out ─────────────────────────────

test("attached reaches the subscriber and the bound terminal", () => {
  const { router } = makeRouter();
  const subscriber = makeSubscriber();
  const a = makeSink();
  router.subscribe(subscriber);
  router.attach("pty-a", null);
  router.registerTerminal("pty-a", a);

  router.route(attachedMsg("pty-a", "task-7"));

  expect(subscriber.received).toEqual([attachedMsg("pty-a", "task-7")]);
  expect(a.received).toEqual([attachedMsg("pty-a", "task-7")]);
});

test("attached still reaches subscribers for a ptyId this client did not attach", () => {
  const { router } = makeRouter();
  const subscriber = makeSubscriber();
  const a = makeSink();
  router.subscribe(subscriber);
  // Registered but never attached: this is how the layer above learns it has
  // been handed an attachment it did not ask for.
  router.registerTerminal("pty-a", a);

  router.route(attachedMsg("pty-a", "task-7"));

  expect(subscriber.received).toEqual([attachedMsg("pty-a", "task-7")]);
  expect(a.received).toEqual([]);
  expect(router.queueDepth("pty-a")).toBe(0);
});

test("other PTY-addressed frames never reach subscribers", () => {
  const { router } = makeRouter();
  const subscriber = makeSubscriber();
  router.subscribe(subscriber);
  router.attach("pty-a", null);
  router.registerTerminal("pty-a", makeSink());

  router.route(data("pty-a", "out"));
  router.route(restore("pty-a"));
  router.route(resized("pty-a"));
  router.route(exited("pty-a"));

  expect(subscriber.received).toEqual([]);
});

// ── non-PTY frames ──────────────────────────────────────────────────────────

test("non-PTY frames fan out to every subscriber and never reach a sink", () => {
  const { router } = makeRouter();
  const one = makeSubscriber();
  const two = makeSubscriber();
  const a = makeSink();
  router.subscribe(one);
  router.subscribe(two);
  router.attach("pty-a", null);
  router.registerTerminal("pty-a", a);

  const frames: ServerMessage[] = [
    { type: "tasks", list: [task("t1")], projects: [] },
    { type: "task", task: task("t1") },
    { type: "activity", taskId: "t1", active: true },
    { type: "notification", taskId: "t1", title: "done", body: "" },
    // Unaddressed: the client-wide half of the error frame.
    { type: "error", message: "nope" },
  ];
  for (const frame of frames) router.route(frame);

  expect(one.received).toEqual(frames);
  expect(two.received).toEqual(frames);
  expect(a.received).toEqual([]);
});

// ── the client-to-server side ───────────────────────────────────────────────

test("attach carries cols and rows when given a size and omits both when null", () => {
  const { router, sent } = makeRouter();
  router.attach("pty-a", { cols: 100, rows: 30 });
  router.attach("pty-b", null);

  expect(sent[0]).toEqual({ type: "attach", ptyId: "pty-a", cols: 100, rows: 30 });
  expect(sent[1]).toEqual({ type: "attach", ptyId: "pty-b" });
  expect(sent[1]).not.toHaveProperty("cols");
  expect(sent[1]).not.toHaveProperty("rows");
  expect(router.isAttached("pty-a")).toBe(true);
  expect(router.isAttached("pty-b")).toBe(true);
  expect(router.isAttached("pty-c")).toBe(false);
});

test("sendInput addresses the input to its ptyId", () => {
  const { router, sent } = makeRouter();
  router.sendInput("pty-a", "ls\r");
  expect(sent).toEqual([{ type: "input", ptyId: "pty-a", data: "ls\r" }]);
});

test("registration alone does not put an attach on the wire", () => {
  const { router, sent } = makeRouter();
  router.registerTerminal("pty-a", makeSink());
  expect(sent).toEqual([]);
});

// ── re-registration ─────────────────────────────────────────────────────────

test("re-registering a ptyId replaces the sink", () => {
  const { router } = makeRouter();
  const first = makeSink();
  const second = makeSink();
  router.attach("pty-a", null);
  router.registerTerminal("pty-a", first);
  router.registerTerminal("pty-a", second);

  router.route(data("pty-a", "out"));

  expect(first.received).toEqual([]);
  expect(dataOf(second)).toEqual(["out"]);
});

test("a late unregister from the previous terminal does not unroute the live one", () => {
  const { router } = makeRouter();
  const first = makeSink();
  const second = makeSink();
  router.attach("pty-a", null);
  const unregisterFirst = router.registerTerminal("pty-a", first);
  router.registerTerminal("pty-a", second);

  // React can run the old terminal's cleanup after the new one has registered.
  unregisterFirst();
  router.route(data("pty-a", "out"));

  expect(dataOf(second)).toEqual(["out"]);
  expect(first.received).toEqual([]);
  expect(router.queueDepth("pty-a")).toBe(0);
});

// ── connect and disconnect ──────────────────────────────────────────────────

test("handleConnect clears the attached set and every queue before notifying", () => {
  const { router } = makeRouter();
  router.attach("pty-a", null);
  router.attach("pty-b", null);
  router.route(data("pty-a", "a1"));
  router.route(data("pty-b", "b1"));

  const seen: Array<{ attached: boolean; depth: number }> = [];
  const subscriber: SocketSubscriber = {
    onConnect: () => {
      // Whoever re-attaches here must not be racing a stale attached set.
      seen.push({ attached: router.isAttached("pty-a"), depth: router.queueDepth("pty-a") });
    },
  };
  router.subscribe(subscriber);

  router.handleConnect();

  expect(seen).toEqual([{ attached: false, depth: 0 }]);
  expect(router.isAttached("pty-b")).toBe(false);
  expect(router.queueDepth("pty-b")).toBe(0);
});

test("handleConnect and handleDisconnect notify every subscriber", () => {
  const { router } = makeRouter();
  const one = makeSubscriber();
  const two = makeSubscriber();
  router.subscribe(one);
  router.subscribe(two);

  router.handleConnect();
  router.handleDisconnect();

  expect([one.connects, one.disconnects]).toEqual([1, 1]);
  expect([two.connects, two.disconnects]).toEqual([1, 1]);
});

test("a subscriber with no handlers is tolerated on every path", () => {
  const { router } = makeRouter();
  router.subscribe({});
  expect(() => {
    router.route({ type: "error", message: "nope" });
    router.handleConnect();
    router.handleDisconnect();
  }).not.toThrow();
});

// ── subscribe / unsubscribe ─────────────────────────────────────────────────

test("the unsubscribe returned by subscribe stops delivery", () => {
  const { router } = makeRouter();
  const one = makeSubscriber();
  const two = makeSubscriber();
  const unsubscribe = router.subscribe(one);
  router.subscribe(two);

  unsubscribe();
  router.route({ type: "error", message: "nope" });
  router.handleConnect();
  router.handleDisconnect();

  expect(one.received).toEqual([]);
  expect(one.connects).toBe(0);
  expect(one.disconnects).toBe(0);
  expect(two.received).toHaveLength(1);
  expect(two.connects).toBe(1);
});

test("unsubscribing during a fan-out does not skip a sibling subscriber", () => {
  const { router } = makeRouter();
  const later = makeSubscriber();
  const unsubscribe = router.subscribe({
    onMessage: () => {
      unsubscribe();
    },
  });
  router.subscribe(later);

  const first: ServerMessage = { type: "error", message: "one" };
  const second: ServerMessage = { type: "error", message: "two" };
  expect(() => router.route(first)).not.toThrow();
  router.route(second);

  // The self-removal happened mid-iteration; the sibling behind it still ran.
  expect(later.received).toEqual([first, second]);
});

test("a subscriber that unsubscribes during onConnect does not skip a sibling", () => {
  const { router } = makeRouter();
  const later = makeSubscriber();
  const unsubscribe = router.subscribe({
    onConnect: () => {
      unsubscribe();
    },
  });
  router.subscribe(later);

  expect(() => router.handleConnect()).not.toThrow();
  expect(later.connects).toBe(1);
});

// ── ptyIdOf ─────────────────────────────────────────────────────────────────

test("ptyIdOf reports the ptyId of every PTY-addressed frame", () => {
  expect(ptyIdOf(data("pty-a", "x"))).toBe("pty-a");
  expect(ptyIdOf(restore("pty-a"))).toBe("pty-a");
  expect(ptyIdOf(resized("pty-a"))).toBe("pty-a");
  expect(ptyIdOf(exited("pty-a"))).toBe("pty-a");
  expect(ptyIdOf(attachedMsg("pty-a"))).toBe("pty-a");
  expect(ptyIdOf(errorFor("pty-a"))).toBe("pty-a");
});

test("ptyIdOf reports null for frames that are not addressed to a terminal", () => {
  expect(ptyIdOf({ type: "tasks", list: [], projects: [] })).toBe(null);
  expect(ptyIdOf({ type: "task", task: task("t1") })).toBe(null);
  expect(ptyIdOf({ type: "activity", taskId: "t1", active: false })).toBe(null);
  expect(ptyIdOf({ type: "notification", taskId: "t1", title: "hi", body: "" })).toBe(null);
  expect(ptyIdOf({ type: "error", message: "nope" })).toBe(null);
});

// ── addressed errors (TASK-49) ──────────────────────────────────────────────

test("an error naming a ptyId lands in that terminal and nowhere else", () => {
  const { router } = makeRouter();
  const a = makeSink();
  const b = makeSink();
  const watcher = makeSubscriber();
  router.subscribe(watcher);
  router.attach("pty-a", null);
  router.attach("pty-b", null);
  router.registerTerminal("pty-a", a);
  router.registerTerminal("pty-b", b);

  const refusal = errorFor("pty-a", 'Terminal "pty-a" not found');
  router.route(refusal);

  expect(a.received).toEqual([refusal]);
  expect(b.received).toEqual([]);
  // It is the terminal's explanation, not the task store's.
  expect(watcher.received).toEqual([]);
});

test("a stale attach paints its refusal into the grid that provoked it", () => {
  const { router } = makeRouter();
  const grid = makeSink();
  // The order a reconnect actually takes: the terminal is mounted and bound,
  // then it asks for a ptyId the daemon no longer has.
  router.registerTerminal("pty-gone", grid);
  router.attach("pty-gone", { cols: 80, rows: 24 });

  const refusal = errorFor("pty-gone", 'Terminal "pty-gone" not found');
  router.route(refusal);

  expect(grid.received).toEqual([refusal]);
});

test("an addressed error queues for a terminal that has not mounted yet", () => {
  const { router } = makeRouter();
  router.attach("pty-a", null);

  const refusal = errorFor("pty-a");
  router.route(refusal);
  expect(router.queueDepth("pty-a")).toBe(1);

  const a = makeSink();
  router.registerTerminal("pty-a", a);
  expect(a.received).toEqual([refusal]);
});

test("an addressed error for a PTY this client gave back is dropped", () => {
  const { router } = makeRouter();
  const a = makeSink();
  const watcher = makeSubscriber();
  router.subscribe(watcher);
  router.registerTerminal("pty-a", a);
  router.attach("pty-a", null);
  router.detach("pty-a");

  // The answer to a keystroke that raced the detach. There is no longer a
  // grid it belongs to, and fanning it out would only turn it into a toast
  // about a terminal the user has already closed.
  router.route(errorFor("pty-a", 'Not attached to terminal "pty-a"'));

  expect(a.received).toEqual([]);
  expect(watcher.received).toEqual([]);
  expect(router.queueDepth("pty-a")).toBe(0);
});
