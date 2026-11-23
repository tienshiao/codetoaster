import { test, expect } from "bun:test";
import { orderChange } from "./reorder-guard";

/**
 * `orderChange` — which drawn sequences count as a reorder, and which rows the
 * cue lands on. The hook around it (when it compares, what it ignores, the
 * lock's timing) is a lifecycle question and is tested by rendering, in
 * `TaskSidebar-reorder.render.tsx`.
 */

test("the same sequence is no change", () => {
  expect(orderChange(["a", "b", "c"], ["a", "b", "c"])).toEqual({ changed: false, cued: [] });
  expect(orderChange([], [])).toEqual({ changed: false, cued: [] });
});

test("one row jumping to the top cues that row and not the rows it passed", () => {
  expect(orderChange(["a", "b", "c", "d"], ["d", "a", "b", "c"])).toEqual({
    changed: true,
    cued: ["d"],
  });
});

test("one row dropping to the bottom cues that row", () => {
  expect(orderChange(["a", "b", "c", "d"], ["b", "c", "d", "a"])).toEqual({
    changed: true,
    cued: ["a"],
  });
});

test("an inserted row changes the order and is cued; the rows it pushed down are not", () => {
  // The rows below it kept their relative order, but every one of them is now
  // one slot lower — under a different pointer.
  expect(orderChange(["a", "b"], ["new", "a", "b"])).toEqual({ changed: true, cued: ["new"] });
});

test("a removed row changes the order and cues nothing", () => {
  // The case the user reported: the rows below slide up under the pointer, and
  // nothing about their relative order says so.
  expect(orderChange(["a", "b", "c"], ["b", "c"])).toEqual({ changed: true, cued: [] });
  expect(orderChange(["a", "b", "c"], ["a", "c"])).toEqual({ changed: true, cued: [] });
});

test("a removal and a move in one step cue only the move", () => {
  expect(orderChange(["a", "b", "c", "d"], ["d", "b", "c"])).toEqual({
    changed: true,
    cued: ["d"],
  });
});

test("a group overtaking another cues the smaller side of the swap", () => {
  const before = ["group:web", "w1", "w2", "w3", "group:infra", "i1"];
  const after = ["group:infra", "i1", "group:web", "w1", "w2", "w3"];
  const { changed, cued } = orderChange(before, after);
  expect(changed).toBe(true);
  expect(cued.sort()).toEqual(["group:infra", "i1"]);
});
