import { test, expect } from "bun:test";
import { parseDiff } from "./parseDiff";

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
