import { test, expect, beforeEach } from "bun:test";
import { installBrokenStorage, installStorage, removeStorage } from "../../test/local-storage";
import {
  loadPaneWidth,
  loadPaneWidths,
  revivePaneWidths,
  savePaneWidth,
  PANE_DEFAULT_PX,
} from "./pane-size-store";

const KEY = "codetoaster:pane-widths";

beforeEach(() => {
  installStorage();
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
