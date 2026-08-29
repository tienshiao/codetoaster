import { test, expect } from "bun:test";
import { Pty, sanitizeSize } from "./pty";

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
