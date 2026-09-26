import { test, expect } from "bun:test";
import { parseDiff } from "./parseDiff";
import { formatOversizedMarker } from "../../lib/diff/oversized";

// The server's oversized marker (TASK-117) stands where the hunks were; the
// status still comes from the header lines the cap keeps.
test.each([
  ["modified", "a/big.json", "b/big.json", []],
  ["added", "/dev/null", "b/big.json", ["new file mode 100644"]],
  ["deleted", "a/big.json", "/dev/null", ["deleted file mode 100644"]],
] as const)("an oversized marker on a %s file sets the flag and the counts", (status, from, to, modeLines) => {
  const diff = [
    "diff --git a/big.json b/big.json",
    ...modeLines,
    "index 1234567..89abcde",
    `--- ${from}`,
    `+++ ${to}`,
    formatOversizedMarker({ bytes: 46_000_000, additions: 4, deletions: 3, longestLine: 22_000_000 }),
    "diff --git a/small.ts b/small.ts",
    "--- a/small.ts",
    "+++ b/small.ts",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "",
  ].join("\n");

  const [big, small] = parseDiff(diff);
  expect(big!.status).toBe(status);
  expect(big!.newPath).toBe("big.json");
  expect(big!.hunks).toHaveLength(0);
  expect(big!.additions).toBe(4);
  expect(big!.deletions).toBe(3);
  expect(big!.oversized).toEqual({ bytes: 46_000_000, longestLine: 22_000_000 });
  expect(small!.oversized).toBeUndefined();
  expect(small!.hunks).toHaveLength(1);
});

test("an oversized marker on a renamed file keeps the rename", () => {
  const diff = [
    "diff --git a/old.json b/new.json",
    "similarity index 90%",
    "rename from old.json",
    "rename to new.json",
    "index 1234567..89abcde 100644",
    "--- a/old.json",
    "+++ b/new.json",
    formatOversizedMarker({ bytes: 2_000_000, additions: 1, deletions: 1, longestLine: 1_999_000 }),
    "",
  ].join("\n");
  const [file] = parseDiff(diff);
  expect(file!.status).toBe("renamed");
  expect(file!.oldPath).toBe("old.json");
  expect(file!.newPath).toBe("new.json");
  expect(file!.oversized).toEqual({ bytes: 2_000_000, longestLine: 1_999_000 });
  expect(file!.hunks).toHaveLength(0);
});

test("a content line that reads like the marker is still content inside a hunk", () => {
  const marker = formatOversizedMarker({ bytes: 1, additions: 9, deletions: 9, longestLine: 1 });
  const diff = [
    "diff --git a/notes.txt b/notes.txt",
    "--- a/notes.txt",
    "+++ b/notes.txt",
    "@@ -1 +1,2 @@",
    " " + marker,
    "+x",
    "",
  ].join("\n");
  const [file] = parseDiff(diff);
  expect(file!.oversized).toBeUndefined();
  expect(file!.additions).toBe(1);
  expect(file!.hunks[0]!.lines[1]!.content).toBe(marker);
});

test("parses quoted paths with octal escapes and trailing tab", () => {
  // Real git output for a modified file whose name contains spaces and an
  // em-dash (\342\200\224): paths are quoted and ---/+++ lines end with a tab
  const diff = [
    'diff --git "a/backlog/milestones/m-0 - m1-\\342\\200\\224-foundations-&-decisions.md" "b/backlog/milestones/m-0 - m1-\\342\\200\\224-foundations-&-decisions.md"',
    "index 1234567..89abcde 100644",
    '--- "a/backlog/milestones/m-0 - m1-\\342\\200\\224-foundations-&-decisions.md"\t',
    '+++ "b/backlog/milestones/m-0 - m1-\\342\\200\\224-foundations-&-decisions.md"\t',
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "",
  ].join("\n");

  const files = parseDiff(diff);
  expect(files).toHaveLength(1);
  expect(files[0]!.oldPath).toBe("backlog/milestones/m-0 - m1-—-foundations-&-decisions.md");
  expect(files[0]!.newPath).toBe("backlog/milestones/m-0 - m1-—-foundations-&-decisions.md");
  expect(files[0]!.status).toBe("modified");
});

test("parses unquoted paths with spaces and trailing tab", () => {
  const diff = [
    "diff --git a/docs/foo bar.md b/docs/foo bar.md",
    "index 1234567..89abcde 100644",
    "--- a/docs/foo bar.md\t",
    "+++ b/docs/foo bar.md\t",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "",
  ].join("\n");

  const files = parseDiff(diff);
  expect(files).toHaveLength(1);
  expect(files[0]!.oldPath).toBe("docs/foo bar.md");
  expect(files[0]!.newPath).toBe("docs/foo bar.md");
  expect(files[0]!.status).toBe("modified");
});

test("parses plain paths without quoting", () => {
  const diff = [
    "diff --git a/src/index.ts b/src/index.ts",
    "index 1234567..89abcde 100644",
    "--- a/src/index.ts",
    "+++ b/src/index.ts",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "",
  ].join("\n");

  const files = parseDiff(diff);
  expect(files).toHaveLength(1);
  expect(files[0]!.oldPath).toBe("src/index.ts");
  expect(files[0]!.newPath).toBe("src/index.ts");
  expect(files[0]!.status).toBe("modified");
  expect(files[0]!.additions).toBe(1);
  expect(files[0]!.deletions).toBe(1);
});

test("parses added file with quoted path", () => {
  const diff = [
    'diff --git a/dev/null "b/notes/plan \\342\\200\\224 v2.md"',
    "new file mode 100644",
    "--- /dev/null",
    '+++ "b/notes/plan \\342\\200\\224 v2.md"\t',
    "@@ -0,0 +1 @@",
    "+hello",
    "",
  ].join("\n");

  const files = parseDiff(diff);
  expect(files).toHaveLength(1);
  expect(files[0]!.newPath).toBe("notes/plan — v2.md");
  expect(files[0]!.status).toBe("added");
});

test("parses a pure rename (100% similarity, no hunks)", () => {
  const diff = [
    "diff --git a/src/old.ts b/src/new.ts",
    "similarity index 100%",
    "rename from src/old.ts",
    "rename to src/new.ts",
    "",
  ].join("\n");

  const files = parseDiff(diff);
  expect(files).toHaveLength(1);
  expect(files[0]!.status).toBe("renamed");
  expect(files[0]!.oldPath).toBe("src/old.ts");
  expect(files[0]!.newPath).toBe("src/new.ts");
  expect(files[0]!.hunks).toHaveLength(0);
  expect(files[0]!.additions).toBe(0);
  expect(files[0]!.deletions).toBe(0);
});

test("parses a rename with content changes (keeps renamed status)", () => {
  const diff = [
    "diff --git a/src/old.ts b/src/new.ts",
    "similarity index 80%",
    "rename from src/old.ts",
    "rename to src/new.ts",
    "--- a/src/old.ts",
    "+++ b/src/new.ts",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "",
  ].join("\n");

  const files = parseDiff(diff);
  expect(files).toHaveLength(1);
  expect(files[0]!.status).toBe("renamed");
  expect(files[0]!.oldPath).toBe("src/old.ts");
  expect(files[0]!.newPath).toBe("src/new.ts");
  expect(files[0]!.additions).toBe(1);
  expect(files[0]!.deletions).toBe(1);
});

test("parses a pure copy (100% similarity, no hunks)", () => {
  const diff = [
    "diff --git a/src/orig.ts b/src/dup.ts",
    "similarity index 100%",
    "copy from src/orig.ts",
    "copy to src/dup.ts",
    "",
  ].join("\n");

  const files = parseDiff(diff);
  expect(files).toHaveLength(1);
  expect(files[0]!.status).toBe("copied");
  expect(files[0]!.oldPath).toBe("src/orig.ts");
  expect(files[0]!.newPath).toBe("src/dup.ts");
});
