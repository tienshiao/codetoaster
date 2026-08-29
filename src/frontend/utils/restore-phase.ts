import type { ServerMessage } from "../../lib/xtmux/types";

// The swap half of the two-phase reopen (docs/v2-architecture.md §5.5). A
// resumed agent repaints from scratch, so the stored snapshot and the screen
// the agent is about to draw will not agree. Rather than pretend otherwise,
// reopening a suspended task shows the snapshot read-only and then swaps the
// whole grid over to the live PTY the moment the agent actually paints.
//
// The ordering that makes it work is subtle enough to be worth having in one
// pure place, tested, with the terminal only wiring it up:
//
//  - The phase is entered *before* either request goes out, so a resume that
//    beats the scrollback fetch is never painted over by a snapshot that
//    arrives late.
//  - An *empty* `restore` is stashed, not applied. It is the blank screen of a
//    process that has not printed anything yet, and applying it would blank the
//    snapshot for the whole of the agent's startup — several seconds of
//    nothing, which is exactly the glitch the two phases exist to avoid.
//  - A `restore` that carries content is the swap, and usually *is* how the
//    swap happens. `resumeTask` awaits `awaitAgentStart` — a hook, or a
//    four-second cap — before the route answers, and only then does the client
//    learn the ptyId it must attach to. So the agent has generally painted
//    before anyone attaches, and that paint is already in the headless
//    terminal: it reaches this client as the `restore`, not as `data`. Waiting
//    for a `data` frame that may never come would leave a resumed-but-quiet
//    agent sitting behind a read-only snapshot for good.
//  - Failing that, the first `data` is the swap. Either way the order is the
//    same: reset, then the paint (its modes, cursor and mouse encoding are the
//    truth about the PTY), then anything that followed it.

type RestoreMessage = Extract<ServerMessage, { type: "restore" }>;

export type RestorePhase =
  /** Live: every frame is applied as it arrives. */
  | { phase: "idle" }
  /** Showing the snapshot, waiting for the resumed agent's first paint. */
  | {
      phase: "restoring";
      /** The PTY the resume produced, once `attached` has named it. Null until
       * then — the phase starts before the agent exists. */
      ptyId: string | null;
      /** The freshly spawned PTY's `restore`, held back until the swap. */
      stashed: RestoreMessage | null;
    };

export type RestoreEffect =
  /** Hand the frame to the terminal exactly as a live one would be. */
  | { kind: "message"; message: ServerMessage }
  /** RIS through the write buffer, clearing the snapshot. */
  | { kind: "reset" };

export interface RestoreStep {
  state: RestorePhase;
  effects: RestoreEffect[];
}

export const IDLE: RestorePhase = { phase: "idle" };

/** Enter the read-only phase. Takes no snapshot: painting one is a separate
 * step precisely because it can arrive after the agent already has. */
export function beginRestore(): RestorePhase {
  return { phase: "restoring", ptyId: null, stashed: null };
}

/** Leave the phase without a swap — a resume that failed, or a task the user
 * navigated away from. Whatever is on the grid stays there; the snapshot is
 * still the last true thing the user saw. */
export function endRestore(): RestorePhase {
  return IDLE;
}

/** Swap on nothing but time.
 *
 * An agent can resume, print nothing, and stay alive — `awaitAgentStart` caps
 * its wait at a few seconds and reports success either way, so this is a state
 * the resume path reaches rather than a hypothetical. With no frame ever
 * arriving there is nothing to trigger the swap, and the grid would sit
 * read-only under a "resuming…" overlay with input gated for as long as the
 * user stayed on the task — recoverable only by navigating away.
 *
 * So the swap happens anyway, and it is a *swap*: reset, then the stashed
 * restore. Merely dropping the phase would leave the live terminal appending
 * its output to a snapshot of a previous life, which is worse than either
 * screen on its own. A quiet agent's stashed restore is empty, so what the user
 * gets is the clean empty terminal that is the truth about it. */
export function timeoutRestore(state: RestorePhase): RestoreStep {
  if (state.phase === "idle") return { state, effects: [] };
  const effects: RestoreEffect[] = [{ kind: "reset" }];
  if (state.stashed) effects.push({ kind: "message", message: state.stashed });
  return { state: IDLE, effects };
}

export function isRestoring(state: RestorePhase): boolean {
  return state.phase === "restoring";
}

/** What to do with an incoming frame, and the phase that follows it. */
export function stepRestore(state: RestorePhase, message: ServerMessage): RestoreStep {
  if (state.phase === "idle") {
    return { state, effects: [{ kind: "message", message }] };
  }

  switch (message.type) {
    case "attached":
      // Recorded, and applied: the terminal needs to know which PTY its input
      // is addressed to before the swap, or the first keystroke after it goes
      // nowhere. Input stays blocked all the same — the gate is the phase, not
      // the attachment.
      return {
        state: { ...state, ptyId: message.ptyId },
        effects: [{ kind: "message", message }],
      };

    case "restore":
      // The heart of it, and the distinction the whole phase turns on: what is
      // being held back is a *blank* screen, not a screen. A restore with
      // content in it is the resumed agent's paint — the usual way the swap
      // arrives, since the agent has normally painted before the client is ever
      // told which PTY to attach to — so it lands rather than waiting for a
      // `data` frame that a quiet agent may never send.
      if (message.data.length > 0) {
        return { state: IDLE, effects: [{ kind: "reset" }, { kind: "message", message }] };
      }
      return { state: { ...state, stashed: message }, effects: [] };

    case "data": {
      const effects: RestoreEffect[] = [{ kind: "reset" }];
      if (state.stashed) effects.push({ kind: "message", message: state.stashed });
      effects.push({ kind: "message", message });
      return { state: IDLE, effects };
    }

    case "resize":
      // Swallowed. The grid is holding a snapshot taken at another size, and
      // reflowing it mid-phase garbles the one thing on screen for no gain: the
      // swap re-sizes from the stashed restore and re-fits to the container
      // straight after, which is where this client's real size comes from
      // anyway.
      return { state, effects: [] };

    case "exit":
    case "error":
      // The agent is not coming, so nothing will ever swap. Drop the stash and
      // let the frame land on top of the snapshot: it is the only explanation
      // the user is going to get, and the screen underneath it is still the
      // last thing that task had to say.
      return { state: IDLE, effects: [{ kind: "message", message }] };

    default:
      return { state, effects: [{ kind: "message", message }] };
  }
}
