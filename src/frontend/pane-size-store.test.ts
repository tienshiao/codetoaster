import { test, expect, beforeEach } from "bun:test";
import { installBrokenStorage, installStorage, removeStorage } from "../../test/local-storage";
import {
  getPaneWidth,
  loadPaneWidth,
  loadPaneWidths,
  paneListenerCount,
  resetPaneWidths,
  revivePaneWidths,
  savePaneWidth,
  setPaneWidth,
  subscribePaneWidth,
  PANE_DEFAULT_PX,
} from "./pane-size-store";

const KEY = "codetoaster:pane-widths";

beforeEach(() => {
  installStorage();
  // The live widths outlive a cleared `localStorage` — a seeded id never reads
  // storage again — so one test's drag would otherwise be the next one's
  // starting width.
  resetPaneWidths();
});

test("an absent record leaves every pane on its default", () => {
  expect(loadPaneWidths()).toEqual({});
  expect(loadPaneWidth("sidebar")).toBe(PANE_DEFAULT_PX.sidebar);
});

test("a stored width comes back", () => {
  savePaneWidth("sidebar", 320);
  expect(loadPaneWidth("sidebar")).toBe(320);
});

test("writing one pane leaves the others alone", () => {
  savePaneWidth("sidebar", 320);
  savePaneWidth("explorer", 400);
  expect(loadPaneWidth("sidebar")).toBe(320);
  expect(loadPaneWidth("explorer")).toBe(400);
});

// The reason `savePaneWidth` re-reads instead of caching: both sidebars are
// mounted at once, so a stale in-memory copy would let the second writer drop
// the first one's width.
test("a width written after another hook read the record survives", () => {
  savePaneWidth("sidebar", 320);
  const before = loadPaneWidths();
  savePaneWidth("explorer", 400);
  expect(before.explorer).toBeUndefined();
  expect(loadPaneWidths()).toEqual({ sidebar: 320, explorer: 400 });
});

// ── the live width, and who hears about it ──────────────────────────────────
//
// Two panes can be reading one id at once, so a drag has to reach the one the
// pointer is not on (§TASK-73).

test("a pane starts at what was stored, and at its default when nothing was", () => {
  savePaneWidth("sidebar", 320);
  resetPaneWidths();
  expect(getPaneWidth("sidebar")).toBe(320);
  expect(getPaneWidth("explorer")).toBe(PANE_DEFAULT_PX.explorer);
});

test("a subscriber hears the pane it reads move", () => {
  let woken = 0;
  subscribePaneWidth("sidebar", () => woken++);
  setPaneWidth("sidebar", 320);
  expect(getPaneWidth("sidebar")).toBe(320);
  expect(woken).toBe(1);
});

// AC3. The reason the map is keyed per pane: dragging the sidebar must not
// re-render every file tree on screen.
test("a subscriber is not woken by a pane it does not read", () => {
  let sidebar = 0;
  let tree = 0;
  subscribePaneWidth("sidebar", () => sidebar++);
  subscribePaneWidth("file-tree", () => tree++);
  setPaneWidth("file-tree", 400);
  expect(tree).toBe(1);
  expect(sidebar).toBe(0);
});

// A drag reports the same pixel repeatedly while the pointer is still.
test("setting the width a pane already has wakes nobody", () => {
  setPaneWidth("sidebar", 320);
  let woken = 0;
  subscribePaneWidth("sidebar", () => woken++);
  setPaneWidth("sidebar", 320);
  expect(woken).toBe(0);
});

// AC4. A closed pane leaves no entry for the next write to walk.
test("unsubscribing drops the listener, and the set with the last of them", () => {
  const off = subscribePaneWidth("sidebar", () => {});
  const offToo = subscribePaneWidth("sidebar", () => {});
  expect(paneListenerCount("sidebar")).toBe(2);
  off();
  expect(paneListenerCount("sidebar")).toBe(1);
  offToo();
  expect(paneListenerCount("sidebar")).toBe(0);
  expect(() => setPaneWidth("sidebar", 400)).not.toThrow();
});

// The reason the walk is over a copy: a woken hook is free to unmount, and
// unmounting is what unsubscribes.
test("a listener that unsubscribes on being woken does not cost the next one", () => {
  let second = 0;
  const off = subscribePaneWidth("sidebar", () => off());
  subscribePaneWidth("sidebar", () => second++);
  setPaneWidth("sidebar", 320);
  expect(second).toBe(1);
  expect(paneListenerCount("sidebar")).toBe(1);
});

// So a width restored from anywhere but a drag still reaches the screen.
test("persisting a width moves the live one with it", () => {
  let woken = 0;
  subscribePaneWidth("sidebar", () => woken++);
  savePaneWidth("sidebar", 320);
  expect(getPaneWidth("sidebar")).toBe(320);
  expect(woken).toBe(1);
});

test.each([
  ["not an object", '"240"'],
  ["an array", "[240]"],
  ["not JSON at all", "{sidebar:"],
])("%s stores nothing and throws nothing", (_label, raw) => {
  localStorage.setItem(KEY, raw);
  expect(loadPaneWidths()).toEqual({});
  expect(loadPaneWidth("sidebar")).toBe(PANE_DEFAULT_PX.sidebar);
});

// Every one of these reaches a `style` attribute if it is trusted, and every
// one of them is something `JSON.parse` will hand back.
test.each([
  ["a string", "240"],
  ["null", null],
  ["NaN, which JSON writes as null", Number.NaN],
  ["infinity", Number.POSITIVE_INFINITY],
  ["a negative", -240],
  ["zero", 0],
])("%s is dropped rather than rendered", (_label, px) => {
  expect(revivePaneWidths({ sidebar: px })).toEqual({});
});

test("an unknown pane id is dropped, so the record cannot grow forever", () => {
  expect(revivePaneWidths({ sidebar: 320, "left-rail": 40 })).toEqual({ sidebar: 320 });
});

test("one bad entry does not cost the good ones", () => {
  expect(revivePaneWidths({ sidebar: 320, explorer: "wide" })).toEqual({ sidebar: 320 });
});

// ── storage that is missing or refusing ─────────────────────────────────────

test("no localStorage at all still renders every pane at its default", () => {
  removeStorage();
  expect(loadPaneWidths()).toEqual({});
  expect(loadPaneWidth("explorer")).toBe(PANE_DEFAULT_PX.explorer);
  expect(() => savePaneWidth("explorer", 400)).not.toThrow();
});

test("storage that throws costs the width, not the render", () => {
  installBrokenStorage();
  expect(loadPaneWidths()).toEqual({});
  expect(() => savePaneWidth("sidebar", 320)).not.toThrow();
});
