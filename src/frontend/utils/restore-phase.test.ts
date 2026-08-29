import { test, expect, describe } from "bun:test";
import {
  IDLE,
  beginRestore,
  endRestore,
  isRestoring,
  stepRestore,
  type RestoreEffect,
  type RestorePhase,
  timeoutRestore,
} from "./restore-phase";
import type { ServerMessage } from "../../lib/xtmux/types";

const PTY = "pty-1";

function attached(ptyId = PTY): ServerMessage {
  return { type: "attached", ptyId, taskId: "task-1" };
}

function restore(data: string, ptyId = PTY): ServerMessage {
  return {
    type: "restore",
    ptyId,
    data,
    size: { cols: 100, rows: 30 },
    cursor: { x: 0, y: 0 },
    cursorHidden: false,
    mouseEncoding: "DEFAULT",
  };
}

function data(text: string, ptyId = PTY): ServerMessage {
  return { type: "data", ptyId, data: text };
}

/** The frames a run actually produced, in order — `reset` for the RIS, and the
 * message type for anything handed to the terminal. */
function trace(effects: RestoreEffect[]): string[] {
  return effects.map((effect) =>
    effect.kind === "reset" ? "reset" : effect.message.type,
  );
}

/** Feed a sequence, answering the phase it ends in and every effect along the
 * way — the shape most of these assertions are about. */
function run(
  start: RestorePhase,
  messages: ServerMessage[],
): { state: RestorePhase; effects: RestoreEffect[] } {
  let state = start;
  const effects: RestoreEffect[] = [];
  for (const message of messages) {
    const step = stepRestore(state, message);
    state = step.state;
    effects.push(...step.effects);
  }
  return { state, effects };
}

describe("idle", () => {
  test("hands every frame straight back", () => {
    for (const message of [attached(), restore("old"), data("x")]) {
      const step = stepRestore(IDLE, message);
      expect(step.state).toEqual(IDLE);
      expect(step.effects).toEqual([{ kind: "message", message }]);
    }
  });
});

describe("restoring", () => {
  test("begins with nothing attached and nothing stashed", () => {
    const state = beginRestore();
    expect(isRestoring(state)).toBe(true);
    expect(state).toEqual({ phase: "restoring", ptyId: null, stashed: null });
  });

  test("records the ptyId from `attached` and stays restoring", () => {
    const step = stepRestore(beginRestore(), attached("pty-fresh"));
    expect(step.state).toEqual({ phase: "restoring", ptyId: "pty-fresh", stashed: null });
    expect(isRestoring(step.state)).toBe(true);
    // Applied, so the terminal knows where its input will be addressed — the
    // gate on input is the phase, not the attachment.
    expect(trace(step.effects)).toEqual(["attached"]);
  });

  test("an empty `restore` arriving alone is stashed, never applied", () => {
    // Empty is the whole point: this is the blank screen of a PTY that has not
    // printed yet, and applying it would wipe the snapshot for the length of
    // the agent's startup.
    const { state, effects } = run(beginRestore(), [attached(), restore("")]);
    expect(effects.filter((e) => e.kind === "message" && e.message.type === "restore")).toEqual([]);
    expect(trace(effects)).toEqual(["attached"]);
    expect(state).toMatchObject({ phase: "restoring" });
    expect(state.phase === "restoring" && state.stashed?.type).toBe("restore");
  });

  test("the last empty `restore` wins if the server sends more than one", () => {
    const { state } = run(beginRestore(), [restore(""), restore("")]);
    expect(state.phase === "restoring" && (state.stashed as any).type).toBe("restore");
  });

  // The usual way the swap actually arrives. `resumeTask` awaits the agent's
  // start before the route answers, so by the time this client is told which
  // PTY to attach to the agent has generally painted — and that paint is in the
  // headless terminal already, reaching us as the `restore` rather than as
  // `data`. Holding it back would strand a resumed-but-quiet agent behind a
  // read-only snapshot for good.
  test("a `restore` with content in it is the swap", () => {
    const { state, effects } = run(beginRestore(), [attached(), restore("the agent repainted")]);
    expect(trace(effects)).toEqual(["attached", "reset", "restore"]);
    expect(state).toEqual(IDLE);
  });

  test("an empty `restore` is held, and a later one with content swaps", () => {
    const { state, effects } = run(beginRestore(), [attached(), restore(""), restore("painted")]);
    expect(trace(effects)).toEqual(["attached", "reset", "restore"]);
    const applied = effects.filter((e) => e.kind === "message");
    expect((applied[1] as any).message.data).toBe("painted");
    expect(state).toEqual(IDLE);
  });

  test("the first `data` swaps: reset, then the stashed restore, then the data", () => {
    const { state, effects } = run(beginRestore(), [
      attached(),
      restore(""),
      data("the agent's first paint"),
    ]);
    expect(trace(effects)).toEqual(["attached", "reset", "restore", "data"]);
    // And in that order, with the payloads intact.
    const applied = effects.filter((e) => e.kind === "message");
    expect((applied[1] as any).message.data).toBe("");
    expect((applied[2] as any).message.data).toBe("the agent's first paint");
    expect(state).toEqual(IDLE);
  });

  test("the swap still resets when no `restore` was ever stashed", () => {
    // Otherwise the agent's output would land on top of the snapshot rather
    // than replacing it.
    const { state, effects } = run(beginRestore(), [attached(), data("paint")]);
    expect(trace(effects)).toEqual(["attached", "reset", "data"]);
    expect(state).toEqual(IDLE);
  });

  test("a second `data` is applied normally, with no second reset", () => {
    const first = run(beginRestore(), [attached(), restore(""), data("one")]);
    const second = stepRestore(first.state, data("two"));
    expect(trace(second.effects)).toEqual(["data"]);
    expect(second.state).toEqual(IDLE);
  });

  test("a `restore` after the swap is applied, not stashed again", () => {
    const first = run(beginRestore(), [data("paint")]);
    const step = stepRestore(first.state, restore("a real session switch"));
    expect(trace(step.effects)).toEqual(["restore"]);
  });

  test("`resize` is swallowed while the snapshot is up", () => {
    const start = run(beginRestore(), [attached(), restore("")]).state;
    const step = stepRestore(start, { type: "resize", ptyId: PTY, cols: 80, rows: 24 });
    expect(step.effects).toEqual([]);
    expect(step.state).toEqual(start);
  });

  test("`exit` leaves the phase and drops the stash", () => {
    const start = run(beginRestore(), [attached(), restore("")]).state;
    const step = stepRestore(start, { type: "exit", ptyId: PTY, code: 1 });
    // The exit notice lands on the snapshot: nothing is going to swap now, and
    // the screen underneath is still the last thing the task had to say.
    expect(trace(step.effects)).toEqual(["exit"]);
    expect(step.state).toEqual(IDLE);
  });

  test("`error` leaves the phase too", () => {
    const step = stepRestore(beginRestore(), { type: "error", message: "no such terminal" });
    expect(trace(step.effects)).toEqual(["error"]);
    expect(step.state).toEqual(IDLE);
  });

  test("an explicit end leaves the phase — the failed-resume door", () => {
    expect(endRestore()).toEqual(IDLE);
    expect(isRestoring(endRestore())).toBe(false);
    // And what follows is ordinary live behaviour, including the `restore` that
    // would have been stashed a moment earlier.
    const step = stepRestore(endRestore(), restore("live"));
    expect(trace(step.effects)).toEqual(["restore"]);
  });

  test("a restore begun twice starts clean rather than inheriting a stash", () => {
    // Opening a second suspended task while the first is still waiting.
    const first = run(beginRestore(), [attached(), restore("first task")]).state;
    expect(first.phase === "restoring" && first.stashed).not.toBeNull();
    expect(beginRestore()).toEqual({ phase: "restoring", ptyId: null, stashed: null });
  });
});

describe("the timeout swap", () => {
  // An agent can resume, print nothing and stay alive, so nothing ever arrives
  // to trigger the swap. Without this the grid stays read-only under the
  // "resuming…" overlay until the user navigates away.
  test("swaps with the stashed restore when no frame ever comes", () => {
    const start = run(beginRestore(), [attached(), restore("")]).state;
    const step = timeoutRestore(start);
    expect(trace(step.effects)).toEqual(["reset", "restore"]);
    expect(step.state).toEqual(IDLE);
  });

  test("still resets when nothing was stashed", () => {
    // The reset is the point: dropping the phase without one would leave live
    // output appending to a snapshot of the task's previous life.
    const step = timeoutRestore(run(beginRestore(), [attached()]).state);
    expect(trace(step.effects)).toEqual(["reset"]);
    expect(step.state).toEqual(IDLE);
  });

  test("is a no-op once the phase has already ended", () => {
    const step = timeoutRestore(IDLE);
    expect(step.effects).toEqual([]);
    expect(step.state).toEqual(IDLE);
  });

  test("leaves the grid in the same state the first frame would have", () => {
    const stashed = run(beginRestore(), [attached(), restore("")]).state;
    const byTimeout = timeoutRestore(stashed);
    const byFrame = stepRestore(stashed, data(""));
    expect(trace(byTimeout.effects)).toEqual(trace(byFrame.effects).filter((t) => t !== "data"));
    expect(byTimeout.state).toEqual(byFrame.state);
  });
});
