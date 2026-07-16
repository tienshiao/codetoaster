import { test, expect } from "bun:test";
import { parseLogOutput, parseRefDecorations } from "./git";

// --- parseRefDecorations -----------------------------------------------------

test("empty decoration → []", () => {
  expect(parseRefDecorations("")).toEqual([]);
  expect(parseRefDecorations("   ")).toEqual([]);
});

test("HEAD -> branch emits both HEAD and the branch name", () => {
  expect(parseRefDecorations("HEAD -> main")).toEqual(["HEAD", "main"]);
});

test("multiple decorations split on ', '", () => {
  expect(parseRefDecorations("HEAD -> main, origin/main, origin/HEAD")).toEqual([
    "HEAD",
    "main",
    "origin/main",
    "origin/HEAD",
  ]);
});

test("tag: prefix is stripped", () => {
  expect(parseRefDecorations("tag: v1.0.0")).toEqual(["v1.0.0"]);
  expect(parseRefDecorations("HEAD -> main, tag: v2.3")).toEqual(["HEAD", "main", "v2.3"]);
});

test("detached HEAD decoration (no arrow)", () => {
  expect(parseRefDecorations("HEAD, main")).toEqual(["HEAD", "main"]);
});

// --- parseLogOutput ----------------------------------------------------------

const F = "\x1f";
const R = "\x1e";

function record(fields: string[]): string {
  return fields.join(F) + R;
}

test("parses a single commit record", () => {
  const out =
    record(["abc123", "def456", "Ada Lovelace", "ada@example.com", "1700000000", "HEAD -> main", "Initial commit"]) +
    "\n";
  const commits = parseLogOutput(out);
  expect(commits).toHaveLength(1);
  expect(commits[0]).toEqual({
    hash: "abc123",
    parents: ["def456"],
    refs: ["HEAD", "main"],
    author: "Ada Lovelace",
    email: "ada@example.com",
    date: 1700000000,
    subject: "Initial commit",
  });
});

test("parses multiple records separated by \\x1e and newlines", () => {
  // Git terminates each record with \x1e followed by a newline; the newline
  // becomes the leading char of the next record after splitting.
  const out =
    record(["h1", "p1", "A", "a@x", "100", "", "first"]) +
    "\n" +
    record(["h2", "p1a p1b", "B", "b@x", "200", "origin/dev", "second"]) +
    "\n";
  const commits = parseLogOutput(out);
  expect(commits).toHaveLength(2);
  expect(commits[0]!.hash).toBe("h1");
  expect(commits[0]!.refs).toEqual([]);
  expect(commits[0]!.parents).toEqual(["p1"]);
  expect(commits[1]!.hash).toBe("h2");
  expect(commits[1]!.parents).toEqual(["p1a", "p1b"]);
  expect(commits[1]!.refs).toEqual(["origin/dev"]);
  expect(commits[1]!.subject).toBe("second");
});

test("root commit has empty parents array", () => {
  const out = record(["root", "", "A", "a@x", "1", "", "root commit"]) + "\n";
  const commits = parseLogOutput(out);
  expect(commits[0]!.parents).toEqual([]);
});

test("empty output → []", () => {
  expect(parseLogOutput("")).toEqual([]);
  expect(parseLogOutput("\n")).toEqual([]);
});

test("subject containing spaces and punctuation is preserved verbatim", () => {
  const out = record(["h", "p", "A", "a@x", "1", "", "fix: handle a, b, and c -> d"]) + "\n";
  const commits = parseLogOutput(out);
  expect(commits[0]!.subject).toBe("fix: handle a, b, and c -> d");
});
