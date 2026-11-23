import { test, expect } from "bun:test";
import { Pty, sanitizeSize } from "./pty";
import { waitFor } from "../../../test/wait";

function settle(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("accepts workable integer sizes", () => {
  expect(sanitizeSize(80, 24)).toEqual({ cols: 80, rows: 24 });
  expect(sanitizeSize(2, 1)).toEqual({ cols: 2, rows: 1 });
  expect(sanitizeSize(10000, 10000)).toEqual({ cols: 10000, rows: 10000 });
});

test("rejects missing or non-numeric values", () => {
  expect(sanitizeSize(undefined, undefined)).toBeNull();
  expect(sanitizeSize(null, null)).toBeNull();
  expect(sanitizeSize("80", "24")).toBeNull();
  expect(sanitizeSize(80, undefined)).toBeNull();
  expect(sanitizeSize(undefined, 24)).toBeNull();
});

test("rejects NaN, infinities, and floats", () => {
  expect(sanitizeSize(NaN, 24)).toBeNull();
  expect(sanitizeSize(80, NaN)).toBeNull();
  expect(sanitizeSize(Infinity, 24)).toBeNull();
  expect(sanitizeSize(80.5, 24)).toBeNull();
});

test("rejects sizes below the workable floor or above the cap", () => {
  expect(sanitizeSize(0, 0)).toBeNull();
  expect(sanitizeSize(1, 1)).toBeNull(); // cols floor is 2
  expect(sanitizeSize(2, 0)).toBeNull();
  expect(sanitizeSize(-80, 24)).toBeNull();
  expect(sanitizeSize(10001, 24)).toBeNull();
  expect(sanitizeSize(80, 10001)).toBeNull();
});

// Activity is edge-triggered on the wire, so a PTY killed inside the 300ms
// debounce window has to send its own falling edge: the timeout that would have
// sent one is cleared, and a dead process can never produce another. Without
// this the sidebar keeps a live dot on a task with nothing behind it — exactly
// what a resume-ladder rung that prints an error and is torn down produces.
test("kill announces that a still-active PTY has gone quiet", async () => {
  const events: boolean[] = [];
  const pty = new Pty("p1", ["sh", "-c", "printf hello; sleep 30"], 80, 24);
  pty.onActivityChange((_id, active) => events.push(active));

  // Long enough for the output to arrive, short enough to stay inside the
  // debounce window the bug depended on.
  await settle(100);
  expect(events).toEqual([true]);

  pty.kill();
  expect(events).toEqual([true, false]);
  expect(pty.isActive).toBe(false);
});

test("kill on a PTY that was already quiet announces nothing", async () => {
  const events: boolean[] = [];
  const pty = new Pty("p2", ["sh", "-c", "sleep 30"], 80, 24);
  pty.onActivityChange((_id, active) => events.push(active));

  await settle(100);
  pty.kill();
  expect(events).toEqual([]);
});

// Claude Code asks for the cursor position about every 200ms, idle or not. As
// activity that held every agent permanently active, and the edges a server
// stall then made were stamped on every task at once (TASK-111). Echo off, as
// the agent's raw mode has it: the headless terminal's answer goes back into the
// PTY, and a cooked tty would print it.
test("a program polling the cursor position is not active", async () => {
  const events: boolean[] = [];
  const pty = new Pty("p4", ["sh", "-c", "stty -echo; while :; do printf '\\033[?6n'; sleep 0.1; done"], 80, 24);
  pty.onActivityChange((_id, active) => events.push(active));
  // The headless terminal's answers, which prove the polls arrived: otherwise a
  // program that never got to print would pass too.
  let answered = 0;
  const write = pty.write.bind(pty);
  pty.write = (data: string) => {
    answered++;
    write(data);
  };

  // The loop never ends on its own, so a failed assertion must not leave it running.
  try {
    await settle(500);
    expect(answered).toBeGreaterThan(1);
    expect(events).toEqual([]);
  } finally {
    pty.kill();
  }
});

test("a query alongside real output is still activity", async () => {
  const events: boolean[] = [];
  const pty = new Pty("p5", ["sh", "-c", "sleep 0.05; printf 'hello\\033[?6n'; sleep 30"], 80, 24);
  pty.onActivityChange((_id, active) => events.push(active));

  expect(await waitFor(() => events.length > 0)).toBe(true);
  expect(events[0]).toBe(true);
  pty.kill();
});

// getCwd used to shell out with Bun.spawnSync, which blocks the daemon's single
// event loop for the whole of `ps` plus `lsof`. TaskManager refreshes the cwd on
// every client attach, so each terminal tab switch stalled every other PTY and
// HTTP route. This asserts the loop keeps turning while the lookup is in flight.
test("getCwd resolves the shell's directory without blocking the event loop", async () => {
  const pty = new Pty("p3", ["sh", "-c", "sleep 30"], 80, 24, { cwd: "/tmp" });
  try {
    await settle(100);
    let ticks = 0;
    const ticking = setInterval(() => ticks++, 1);
    const cwd = await pty.getCwd();
    clearInterval(ticking);

    // /tmp is a symlink to /private/tmp on macOS, so compare on the resolved end.
    expect(cwd).toBeDefined();
    expect(cwd!.endsWith("/tmp")).toBe(true);
    expect(ticks).toBeGreaterThan(0);
  } finally {
    pty.kill();
  }
});

test("getCwd resolves to undefined for a PTY whose process is gone", async () => {
  const pty = new Pty("p4", ["sh", "-c", "exit 0"], 80, 24);
  await settle(100);
  expect(await pty.getCwd()).toBeUndefined();
  pty.kill();
});

test("serialize hands back what the terminal has painted", async () => {
  const pty = new Pty("p5", ["sh", "-c", "printf 'snapshot me'; sleep 30"], 80, 24);
  try {
    await settle(200);
    expect(pty.serialize()).toContain("snapshot me");
  } finally {
    pty.kill();
  }
});

// Harvesting is snapshot-then-kill, so a serialize can land on the far side of
// a dispose — out of a background interval, where a throw would take the rest
// of the tick's tasks with it.
test("serialize is empty once the terminal is gone, rather than throwing", async () => {
  const pty = new Pty("p6", ["sh", "-c", "printf 'snapshot me'; sleep 30"], 80, 24);
  await settle(200);
  pty.kill();

  expect(pty.serialize()).toBe("");
  // And killing twice is not a second dispose.
  pty.kill();
  expect(pty.serialize()).toBe("");
});

// TASK-151: Bun sometimes runs a spawn's `onExit` inside `Bun.spawn` itself,
// before any caller can have registered. Waiting for the exit before listening
// takes the same road deterministically: an exit that happened with nobody
// listening still reaches the first listener, with its code.
test("an exit that happened before anyone listened reaches the first listener", async () => {
  const pty = new Pty("p7", ["sh", "-c", "exit 3"], 80, 24);
  try {
    expect(await waitFor(() => pty.exited)).toBe(true);
    const heard: number[] = [];
    pty.onExit((code) => heard.push(code));
    // Not inline: the caller finishes wiring the PTY before the exit lands.
    expect(heard).toEqual([]);
    expect(await waitFor(() => heard.length > 0)).toBe(true);
    expect(heard).toEqual([3]);

    // Once. A second listener is not told about an exit already delivered.
    const late: number[] = [];
    pty.onExit((code) => late.push(code));
    await settle(20);
    expect(late).toEqual([]);
    expect(heard).toEqual([3]);
  } finally {
    pty.kill();
  }
});

test("a listener registered before the exit hears it exactly once", async () => {
  const pty = new Pty("p8", ["sh", "-c", "sleep 0.1; exit 4"], 80, 24);
  try {
    const heard: number[] = [];
    pty.onExit((code) => heard.push(code));
    expect(await waitFor(() => heard.length > 0)).toBe(true);
    await settle(20);
    expect(heard).toEqual([4]);
  } finally {
    pty.kill();
  }
});
