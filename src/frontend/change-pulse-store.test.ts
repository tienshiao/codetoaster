import { expect, test } from "bun:test";
import { ChangePulseStore, PULSE_MS, flashClass, pulseAt, pulseUnder } from "./change-pulse-store";

function clock(start = 1_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

test("a recorded path is showable to a list mounted before it, inside the window", () => {
  const c = clock();
  const store = new ChangePulseStore(c.now);
  const since = c.now();
  c.advance(10);
  store.record("t1", ["src/a.ts"]);
  const pulses = store.pulses("t1");
  expect(pulseAt(pulses, "src/a.ts", since, c.now())).toBeDefined();
  expect(pulseAt(pulses, "src/b.ts", since, c.now())).toBeUndefined();
  // Out of the window it is gone.
  expect(pulseAt(pulses, "src/a.ts", since, c.now() + PULSE_MS)).toBeUndefined();
});

test("a list mounted after the change does not show it", () => {
  const c = clock();
  const store = new ChangePulseStore(c.now);
  store.record("t1", ["src/a.ts"]);
  c.advance(5);
  expect(pulseAt(store.pulses("t1"), "src/a.ts", c.now(), c.now())).toBeUndefined();
});

test("roots are separate", () => {
  const store = new ChangePulseStore(clock().now);
  store.record("t1", ["a"]);
  expect(store.pulses("t2").size).toBe(0);
});

test("recording drops the root's expired pulses and gives a new snapshot", () => {
  const c = clock();
  const store = new ChangePulseStore(c.now);
  store.record("t1", ["old"]);
  const first = store.pulses("t1");
  c.advance(PULSE_MS);
  store.record("t1", ["new"]);
  const second = store.pulses("t1");
  expect(second).not.toBe(first);
  expect([...second.keys()]).toEqual(["new"]);
});

test("retain forgets the roots that are gone", () => {
  const store = new ChangePulseStore(clock().now);
  store.record("t1", ["a"]);
  store.record("t2", ["a"]);
  store.retain(new Set(["t2"]));
  expect(store.pulses("t1").size).toBe(0);
  expect(store.pulses("t2").size).toBe(1);
});

test("an empty frame records nothing and notifies nobody", () => {
  const store = new ChangePulseStore(clock().now);
  let calls = 0;
  store.subscribe("t1", () => calls++);
  store.record("t1", [], []);
  expect(calls).toBe(0);
  store.record("t1", ["a"]);
  expect(calls).toBe(1);
});

test("a repeat change moves the sequence, so the class alternates", () => {
  const c = clock();
  const store = new ChangePulseStore(c.now);
  const since = c.now();
  store.record("t1", ["a"]);
  const first = pulseAt(store.pulses("t1"), "a", since, c.now())!;
  store.record("t1", ["a"]);
  const second = pulseAt(store.pulses("t1"), "a", since, c.now())!;
  expect(flashClass(second.seq)).not.toBe(flashClass(first.seq));
});

// Found in the browser: with one counter for the whole store, the frames for
// other paths in between decided the parity, and an odd number of them left a
// row on the class it already had — its second change did not flash.
test("a path alternates its class however many other paths changed in between", () => {
  const c = clock();
  const store = new ChangePulseStore(c.now);
  const since = c.now();
  const classOf = (path: string) => flashClass(pulseAt(store.pulses("t1"), path, since, c.now())!.seq);
  store.record("t1", ["a"]);
  const first = classOf("a");
  store.record("t1", ["b"]);
  store.record("t1", ["a"]);
  expect(classOf("a")).not.toBe(first);
});

test("a collapsed directory alternates per frame, whichever child changed", () => {
  const c = clock();
  const store = new ChangePulseStore(c.now);
  const since = c.now();
  const classOf = () => flashClass(pulseUnder(store.pulses("t1"), "src", since, c.now())!.seq);
  store.record("t1", ["src/a.ts", "src/b.ts"]);
  const first = classOf();
  // A different child, each starting its own count at zero.
  store.record("t1", ["src/c.ts"]);
  expect(classOf()).not.toBe(first);
});

test("a directory rolls up the newest change under it, but not ignored ones", () => {
  const c = clock();
  const store = new ChangePulseStore(c.now);
  const since = c.now();
  store.record("t1", ["src/lib/a.ts"], ["dist/out.js"]);
  const pulses = store.pulses("t1");
  expect(pulseUnder(pulses, "src", since, c.now())).toBeDefined();
  expect(pulseUnder(pulses, "src/lib", since, c.now())).toBeDefined();
  // A sibling whose name merely starts the same is not under it.
  expect(pulseUnder(pulses, "sr", since, c.now())).toBeUndefined();
  expect(pulseUnder(pulses, "dist", since, c.now())).toBeUndefined();
  // The ignored file's own row still flashes.
  expect(pulseAt(pulses, "dist/out.js", since, c.now())).toBeDefined();
});
