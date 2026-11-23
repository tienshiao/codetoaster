import { test, expect } from "bun:test";
import { SystemLoadStore } from "./system-load-store";
import type { LoadSample } from "@/lib/xtmux/types";

const sample = (at: number, cpu: number | null = 10): LoadSample => ({
  at,
  cpu,
  load: [1, 1, 1],
  cores: 8,
});

test("the history replaces whatever was held", () => {
  const store = new SystemLoadStore();
  store.append({ type: "load", sample: sample(1) });
  store.replace({ type: "loadHistory", intervalMs: 1000, capacity: 5, samples: [sample(10), sample(11)] });
  expect(store.get().samples.map((s) => s.at)).toEqual([10, 11]);
  expect(store.get().intervalMs).toBe(1000);
});

test("ticks append and the list is trimmed to the daemon's capacity", () => {
  const store = new SystemLoadStore();
  store.replace({ type: "loadHistory", intervalMs: 1000, capacity: 3, samples: [sample(1), sample(2)] });
  store.append({ type: "load", sample: sample(3) });
  store.append({ type: "load", sample: sample(4) });
  expect(store.get().samples.map((s) => s.at)).toEqual([2, 3, 4]);
});

test("a tick the history already carried is dropped", () => {
  const store = new SystemLoadStore();
  store.replace({ type: "loadHistory", intervalMs: 1000, capacity: 3, samples: [sample(1), sample(2)] });
  store.append({ type: "load", sample: sample(2) });
  expect(store.get().samples).toHaveLength(2);
});

test("a disconnect empties it, and tells subscribers", () => {
  const store = new SystemLoadStore();
  store.replace({ type: "loadHistory", intervalMs: 1000, capacity: 3, samples: [sample(1)] });
  let heard = 0;
  store.subscribe(() => heard++);
  store.reset();
  expect(store.get().samples).toEqual([]);
  expect(heard).toBe(1);
  // Nothing held, nothing to say.
  store.reset();
  expect(heard).toBe(1);
});
