import { test, expect } from "bun:test";
import { createKeyedListeners } from "./keyed-listeners";

/**
 * The registry `pane-size-store` and `view-state-store` both notify through.
 * What is worth pinning here is not that a callback runs — it is the two things
 * a hand-written Map of Sets gets wrong: a listener that unsubscribes while it
 * is being walked, and an emptied key that is left behind.
 */

test("a listener hears its own key and no other", () => {
  const listeners = createKeyedListeners<string>();
  let sidebar = 0;
  let tree = 0;
  listeners.subscribe("sidebar", () => sidebar++);
  listeners.subscribe("file-tree", () => tree++);

  listeners.notify("file-tree");

  expect(tree).toBe(1);
  expect(sidebar).toBe(0);
});

test("a key nobody subscribed to notifies nothing and throws nothing", () => {
  const listeners = createKeyedListeners<string>();
  expect(() => listeners.notify("sidebar")).not.toThrow();
});

test("unsubscribing drops the listener, and the key with the last of them", () => {
  const listeners = createKeyedListeners<string>();
  const off = listeners.subscribe("sidebar", () => {});
  const offToo = listeners.subscribe("sidebar", () => {});
  expect(listeners.count("sidebar")).toBe(2);

  off();
  expect(listeners.count("sidebar")).toBe(1);
  offToo();
  // Zero, and the Set is gone with it, so a key nobody reads any more leaves no
  // entry for the next notify to walk.
  expect(listeners.count("sidebar")).toBe(0);
  expect(() => listeners.notify("sidebar")).not.toThrow();
});

test("unsubscribing twice is not two removals", () => {
  const listeners = createKeyedListeners<string>();
  const off = listeners.subscribe("sidebar", () => {});
  listeners.subscribe("sidebar", () => {});
  off();
  off();
  expect(listeners.count("sidebar")).toBe(1);
});

// The reason the walk is over a copy: a woken hook is free to unmount, and
// unmounting is what unsubscribes.
test("a listener that unsubscribes on being woken does not cost the next one", () => {
  const listeners = createKeyedListeners<string>();
  let second = 0;
  const off = listeners.subscribe("sidebar", () => off());
  listeners.subscribe("sidebar", () => second++);

  listeners.notify("sidebar");

  expect(second).toBe(1);
  expect(listeners.count("sidebar")).toBe(1);
});

test("clearing forgets every key", () => {
  const listeners = createKeyedListeners<string>();
  let woken = 0;
  listeners.subscribe("sidebar", () => woken++);
  listeners.subscribe("explorer", () => woken++);

  listeners.clear();

  expect(listeners.count("sidebar")).toBe(0);
  listeners.notify("sidebar");
  listeners.notify("explorer");
  expect(woken).toBe(0);
});
