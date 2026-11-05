import { expect, test } from "bun:test";
import { changedLines } from "./changedLines";

const lines = (s: string) => (s === "" ? [] : s.split(" "));

test("identical content changes nothing", () => {
  expect(changedLines(lines("a b c"), lines("a b c"))).toEqual([]);
  expect(changedLines([], [])).toEqual([]);
});

test("a rewritten line is reported at its index", () => {
  expect(changedLines(lines("a b c"), lines("a X c"))).toEqual([1]);
});

test("inserted lines are reported, the lines around them are not", () => {
  expect(changedLines(lines("a b c"), lines("a b X Y c"))).toEqual([2, 3]);
  expect(changedLines(lines("a b"), lines("X a b"))).toEqual([0]);
  expect(changedLines(lines("a b"), lines("a b X"))).toEqual([2]);
});

test("two separate edits flash both and nothing between them", () => {
  expect(changedLines(lines("a b c d e"), lines("a X c d Y"))).toEqual([1, 4]);
});

test("a duplicate inserted beside its twins flashes the new one", () => {
  // `}` `}` → `}` `}` `}` with a changed line after: the LCS keeps the
  // original two matched instead of guessing.
  expect(changedLines(lines("f } } g"), lines("f } } } h"))).toEqual([3, 4]);
});

test("a pure deletion reports the line now standing where it was", () => {
  expect(changedLines(lines("a b c d"), lines("a d"))).toEqual([1]);
  // At the end: the last remaining line.
  expect(changedLines(lines("a b c"), lines("a"))).toEqual([0]);
  // Everything removed: nothing to point at.
  expect(changedLines(lines("a b"), [])).toEqual([]);
});

test("a new file reports every line", () => {
  expect(changedLines([], lines("a b"))).toEqual([0, 1]);
});

test("past the cell cap it falls back to counting and still finds the edits", () => {
  const before = Array.from({ length: 50 }, (_, i) => `line ${i}`);
  const after = [...before];
  after[10] = "changed 10";
  after[40] = "changed 40";
  // A cap of 1 forces the multiset path.
  expect(changedLines(before, after, 1)).toEqual([10, 40]);
  expect(changedLines(before, after)).toEqual([10, 40]);
});
