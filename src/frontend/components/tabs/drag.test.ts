import { test, expect } from "bun:test";
import {
  clampPaneWidth,
  dropIndexAt,
  moveIndexFor,
  nextPaneWidth,
  resizeFlex,
  type TabBox,
} from "./drag";

// Three 100px tabs starting at x=0, the shape every drop test below reads
// against: midpoints at 50, 150 and 250.
const boxes: TabBox[] = [
  { id: "a", left: 0, width: 100 },
  { id: "b", left: 100, width: 100 },
  { id: "c", left: 200, width: 100 },
];

// ── dropIndexAt ─────────────────────────────────────────────────────────────

test("a drop lands before a tab up to its midpoint and after it beyond", () => {
  expect(dropIndexAt(boxes, 0)).toBe(0);
  expect(dropIndexAt(boxes, 49)).toBe(0);
  expect(dropIndexAt(boxes, 50)).toBe(1);
  expect(dropIndexAt(boxes, 149)).toBe(1);
  expect(dropIndexAt(boxes, 150)).toBe(2);
  expect(dropIndexAt(boxes, 250)).toBe(3);
});

test("a drop on the empty stretch past the last tab appends", () => {
  expect(dropIndexAt(boxes, 900)).toBe(3);
});

test("a drop left of the first tab lands at the front", () => {
  expect(dropIndexAt(boxes, -40)).toBe(0);
});

test("an empty strip takes a drop anywhere at index 0", () => {
  expect(dropIndexAt([], 0)).toBe(0);
  expect(dropIndexAt([], 500)).toBe(0);
});

test("tabs of different widths use their own midpoints, not a uniform pitch", () => {
  const uneven: TabBox[] = [
    { id: "a", left: 0, width: 40 },
    { id: "b", left: 40, width: 300 },
  ];
  expect(dropIndexAt(uneven, 21)).toBe(1);
  expect(dropIndexAt(uneven, 189)).toBe(1);
  expect(dropIndexAt(uneven, 191)).toBe(2);
});

// ── moveIndexFor ────────────────────────────────────────────────────────────

test("dropping a tab on either side of itself is a no-op", () => {
  expect(moveIndexFor(boxes, 1, "b")).toBe(null);
  expect(moveIndexFor(boxes, 2, "b")).toBe(null);
});

test("a drop to the right is one lower once the tab is lifted out", () => {
  // "after c" is index 3 on screen, but with `a` removed there are two tabs
  // left and the end of them is index 2.
  expect(moveIndexFor(boxes, 3, "a")).toBe(2);
});

test("a drop to the left is the index it looks like", () => {
  expect(moveIndexFor(boxes, 0, "c")).toBe(0);
  expect(moveIndexFor(boxes, 1, "c")).toBe(1);
});

test("a tab from another group is inserted at the index it was dropped on", () => {
  // Nothing is lifted out of this group, so no correction applies.
  expect(moveIndexFor(boxes, 2, "from-elsewhere")).toBe(2);
});

// ── resizeFlex ──────────────────────────────────────────────────────────────

test("dragging a boundary right gives the left group the pixels", () => {
  const next = resizeFlex([1, 1], [400, 400], 0, 100);
  expect(next).toEqual([1.25, 0.75]);
});

test("the pair's total share is preserved, so the drag is local to the boundary", () => {
  const next = resizeFlex([1, 2, 1], [200, 400, 200], 1, 100);
  expect(next[0]).toBe(1);
  expect(next[1]! + next[2]!).toBeCloseTo(3, 10);
  expect(next[1]).toBeGreaterThan(2);
});

test("a group cannot be dragged narrower than the minimum", () => {
  const next = resizeFlex([1, 1], [400, 400], 0, -900, 120);
  // 120 of the 800px pair, which is 0.3 of the pair's 2 shares.
  expect(next[0]).toBeCloseTo(0.3, 10);
  expect(next[1]).toBeCloseTo(1.7, 10);
});

test("the minimum applies to the group being shrunk on the right as well", () => {
  const next = resizeFlex([1, 1], [400, 400], 0, 900, 120);
  expect(next[0]).toBeCloseTo(1.7, 10);
  expect(next[1]).toBeCloseTo(0.3, 10);
});

test("a pair too narrow for two minimums is left alone rather than halved", () => {
  expect(resizeFlex([1, 1], [100, 100], 0, 50, 120)).toEqual([1, 1]);
});

test("a boundary that names no pair leaves every share untouched", () => {
  expect(resizeFlex([1], [800], 0, 50)).toEqual([1]);
  expect(resizeFlex([1, 1], [400, 400], 5, 50)).toEqual([1, 1]);
});

// ── a fixed-width pane ──────────────────────────────────────────────────────
//
// A 1000px pair throughout — a sidebar and the main area beside it — with a
// 160px floor for the pane and 240px kept for what it sits next to, so the
// usable range is 160..760.

const MIN = 160;
const REST = 240;

test("a width inside the range is left exactly as asked", () => {
  expect(clampPaneWidth(400, 1000, MIN, REST)).toBe(400);
});

test("a pane cannot be dragged below the width of its own handle", () => {
  expect(clampPaneWidth(20, 1000, MIN, REST)).toBe(MIN);
  expect(clampPaneWidth(-500, 1000, MIN, REST)).toBe(MIN);
});

// AC5. The width the user set on a wide monitor, restored into a laptop.
test("a stored width wider than the window comes back clamped", () => {
  expect(clampPaneWidth(900, 1000, MIN, REST)).toBe(760);
});

test("the neighbour keeps its room no matter how far the drag goes", () => {
  expect(clampPaneWidth(Number.MAX_SAFE_INTEGER, 1000, MIN, REST)).toBe(760);
});

// The two floors cannot both be honoured on a pair this narrow, and the pane's
// own is the one that matters: a pane clamped to nothing has no handle left to
// drag back out with.
test("on a pair too narrow for both floors the pane keeps its own", () => {
  expect(clampPaneWidth(400, 300, MIN, REST)).toBe(MIN);
});

// The first render, before any observer has measured. Guessing a width from an
// unmeasured pair is how a panel paints one width and then jumps to another.
test("an unmeasured pair clamps to the floor and nothing else", () => {
  expect(clampPaneWidth(900, 0, MIN, REST)).toBe(900);
  expect(clampPaneWidth(20, 0, MIN, REST)).toBe(MIN);
});

test("a width that is not a number falls back to the floor", () => {
  expect(clampPaneWidth(Number.NaN, 1000, MIN, REST)).toBe(MIN);
});

test("a left-hand pane grows as the pointer moves right", () => {
  expect(nextPaneWidth(400, 60, "left", 1000, MIN, REST)).toBe(460);
  expect(nextPaneWidth(400, -60, "left", 1000, MIN, REST)).toBe(340);
});

// The Explorer. Its divider is on its left, so the same rightward pointer
// travel that widens the sidebar has to narrow it.
test("a right-hand pane grows as the pointer moves left", () => {
  expect(nextPaneWidth(400, -60, "right", 1000, MIN, REST)).toBe(460);
  expect(nextPaneWidth(400, 60, "right", 1000, MIN, REST)).toBe(340);
});

test("a drag is clamped by the same rules as a restore", () => {
  expect(nextPaneWidth(400, 5000, "left", 1000, MIN, REST)).toBe(760);
  expect(nextPaneWidth(400, -5000, "left", 1000, MIN, REST)).toBe(MIN);
});

// Measured from the width at pointerdown, so a gesture is reversible: dragging
// past the floor and back returns to where it started rather than to the floor
// plus whatever came after it.
test("a drag past the floor and back lands where it started", () => {
  const start = 400;
  expect(nextPaneWidth(start, -5000, "left", 1000, MIN, REST)).toBe(MIN);
  expect(nextPaneWidth(start, 0, "left", 1000, MIN, REST)).toBe(start);
});
