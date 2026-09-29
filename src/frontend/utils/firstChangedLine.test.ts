import { test, expect } from "bun:test";
import { parseDiff } from "./parseDiff";
import { firstChangedLine } from "./firstChangedLine";

function file(...body: string[]) {
  const [parsed] = parseDiff(["diff --git a/f.ts b/f.ts", "--- a/f.ts", "+++ b/f.ts", ...body, ""].join("\n"));
  return parsed!;
}

test("lands on the first added line, not the hunk's leading context", () => {
  const f = file("@@ -10,4 +10,5 @@", " a", " b", " c", "+new", " d");
  expect(firstChangedLine(f)).toBe(13);
});

test("a deletion lands on the line that now follows it, past git's usual three of context", () => {
  const f = file("@@ -10,7 +10,6 @@", " a", " b", " c", "-gone", " d", " e", " f");
  expect(firstChangedLine(f)).toBe(13);
});

test("an earlier deletion-only hunk wins over a later addition", () => {
  const f = file("@@ -5,3 +5,2 @@", " a", "-gone", " b", "@@ -40,2 +39,3 @@", " x", "+added", " y");
  expect(firstChangedLine(f)).toBe(6);
});

test("within a hunk the first change in order wins, deletion or not", () => {
  const f = file("@@ -1,5 +1,5 @@", " a", "-b", " c", "+d", " e");
  expect(firstChangedLine(f)).toBe(2);
});

test("a file whose first line was deleted lands on line 1, not 0", () => {
  const f = file("@@ -1,2 +0,0 @@", "-a", "-b");
  expect(firstChangedLine(f)).toBe(1);
});

test("a diff with no hunks has nowhere to point", () => {
  expect(firstChangedLine({ oldPath: "a", newPath: "b", status: "renamed", hunks: [], additions: 0, deletions: 0 })).toBeUndefined();
});
