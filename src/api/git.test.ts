import { test, expect } from "bun:test";
import { parseLogOutput, parseRefDecorations, applyAfterCheck, sliceUntil, parseBatchCheck, LOG_BODY_CAP } from "./git";
import type { GitLogCommit } from "./git";
import { buildFileListing } from "./utils";

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
    record([
      "abc123",
      "def456",
      "Ada Lovelace",
      "ada@example.com",
      "1700000000",
      "HEAD -> main",
      "Initial commit",
      "",
    ]) + "\n";
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
    body: "",
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

test("a multi-line body is kept whole, with git's trailing newline dropped", () => {
  // Git writes the body verbatim and then a newline before the record
  // terminator. The blank line *inside* the message is the author's paragraph
  // break and has to survive; the one at the end is git's punctuation.
  const body = "Why this had to change.\n\nAnd the part nobody would guess.\n";
  const out = record(["h", "p", "A", "a@x", "1", "", "fix: the thing", body]) + "\n";
  const commits = parseLogOutput(out);
  expect(commits[0]!.subject).toBe("fix: the thing");
  expect(commits[0]!.body).toBe("Why this had to change.\n\nAnd the part nobody would guess.");
});

test("a subject-only commit has an empty body, not a whitespace one", () => {
  // `%b` on a one-line message is empty, so the field is git's own newline and
  // nothing else — which must not read as "there is a body" downstream.
  const out = record(["h", "p", "A", "a@x", "1", "", "chore: bump", "\n"]) + "\n";
  expect(parseLogOutput(out)[0]!.body).toBe("");
});

test("a record from the older seven-field format still parses, with no body", () => {
  const out = record(["h", "p", "A", "a@x", "1", "", "fix: the thing"]) + "\n";
  const commits = parseLogOutput(out);
  expect(commits).toHaveLength(1);
  expect(commits[0]!.subject).toBe("fix: the thing");
  expect(commits[0]!.body).toBe("");
});

test("a body past the cap is cut to it, and every other field survives", () => {
  // The row is a hover card's worth of message, not the message: a generated
  // commit note or a pasted stack trace would otherwise ride in every page the
  // client caches, for a card that clips after a dozen lines.
  const body = "x".repeat(LOG_BODY_CAP + 500);
  const out = record(["h", "p", "A", "a@x", "1", "", "fix: the thing", body]) + "\n";
  const commits = parseLogOutput(out);
  expect(commits[0]!.body).toHaveLength(LOG_BODY_CAP);
  expect(commits[0]!.body).toBe("x".repeat(LOG_BODY_CAP));
  expect(commits[0]!.subject).toBe("fix: the thing");
});

test("a separator inside the body rejoins rather than truncating the message", () => {
  const out =
    record(["h", "p", "A", "a@x", "1", "", "fix: the thing", `paste\x1fof a log line`]) + "\n";
  expect(parseLogOutput(out)[0]!.body).toBe("paste\x1fof a log line");
});

// --- applyAfterCheck ---------------------------------------------------------

function commit(hash: string): GitLogCommit {
  return {
    hash,
    parents: [],
    refs: [],
    author: "A",
    email: "a@x",
    date: 0,
    subject: hash,
    body: "",
  };
}

test("applyAfterCheck: row 0 matches after → predecessor dropped, remainder returned", () => {
  const rows = [commit("x0"), commit("x1"), commit("x2")];
  const result = applyAfterCheck(rows, "x0");
  expect(result).toEqual({ rows: [commit("x1"), commit("x2")] });
});

test("applyAfterCheck: row 0 mismatch → stale", () => {
  const rows = [commit("y0"), commit("y1")];
  expect(applyAfterCheck(rows, "x0")).toEqual({ stale: true });
});

test("applyAfterCheck: empty rows + after → stale", () => {
  expect(applyAfterCheck([], "x0")).toEqual({ stale: true });
});

// --- sliceUntil --------------------------------------------------------------

test("sliceUntil: found at start → single commit, hasMore true", () => {
  const rows = [commit("a"), commit("b"), commit("c")];
  expect(sliceUntil(rows, "a", false)).toEqual({
    commits: [commit("a")],
    hasMore: true,
    found: true,
  });
});

test("sliceUntil: found in middle → inclusive slice, hasMore true", () => {
  const rows = [commit("a"), commit("b"), commit("c")];
  expect(sliceUntil(rows, "b", false)).toEqual({
    commits: [commit("a"), commit("b")],
    hasMore: true,
    found: true,
  });
});

test("sliceUntil: found at end, not truncated → all rows, hasMore false", () => {
  const rows = [commit("a"), commit("b"), commit("c")];
  expect(sliceUntil(rows, "c", false)).toEqual({
    commits: [commit("a"), commit("b"), commit("c")],
    hasMore: false,
    found: true,
  });
});

test("sliceUntil: found at last row but fetch truncated at cap → hasMore true", () => {
  const rows = [commit("a"), commit("b"), commit("c")];
  expect(sliceUntil(rows, "c", true)).toEqual({
    commits: [commit("a"), commit("b"), commit("c")],
    hasMore: true,
    found: true,
  });
});

test("sliceUntil: found before last row is unaffected by fetchTruncated flag", () => {
  const rows = [commit("a"), commit("b"), commit("c")];
  expect(sliceUntil(rows, "b", true)).toEqual({
    commits: [commit("a"), commit("b")],
    hasMore: true,
    found: true,
  });
});

test("sliceUntil: missing → empty commits, found false, hasMore true", () => {
  const rows = [commit("a"), commit("b")];
  expect(sliceUntil(rows, "z", false)).toEqual({ commits: [], hasMore: true, found: false });
});

// --- buildFileListing --------------------------------------------------------

test("buildFileListing: empty input → []", () => {
  expect(buildFileListing([])).toEqual([]);
});

test("buildFileListing: root-level files have depth 0 and synthesize no dirs", () => {
  expect(buildFileListing(["README.md", "LICENSE"])).toEqual([
    { path: "README.md", name: "README.md", isDirectory: false, depth: 0 },
    { path: "LICENSE", name: "LICENSE", isDirectory: false, depth: 0 },
  ]);
});

test("buildFileListing: nested file synthesizes parent dirs before the file, with ascending depth", () => {
  expect(buildFileListing(["src/api/git.ts"])).toEqual([
    { path: "src", name: "src", isDirectory: true, depth: 0 },
    { path: "src/api", name: "api", isDirectory: true, depth: 1 },
    { path: "src/api/git.ts", name: "git.ts", isDirectory: false, depth: 2 },
  ]);
});

test("buildFileListing: shared parent dir is emitted once for sibling files", () => {
  expect(buildFileListing(["src/a.ts", "src/b.ts"])).toEqual([
    { path: "src", name: "src", isDirectory: true, depth: 0 },
    { path: "src/a.ts", name: "a.ts", isDirectory: false, depth: 1 },
    { path: "src/b.ts", name: "b.ts", isDirectory: false, depth: 1 },
  ]);
});

test("buildFileListing: dedups shared prefixes across deeper trees, preserving first-seen order", () => {
  expect(buildFileListing(["src/api/git.ts", "src/api/utils.ts", "src/lib/x.ts"])).toEqual([
    { path: "src", name: "src", isDirectory: true, depth: 0 },
    { path: "src/api", name: "api", isDirectory: true, depth: 1 },
    { path: "src/api/git.ts", name: "git.ts", isDirectory: false, depth: 2 },
    { path: "src/api/utils.ts", name: "utils.ts", isDirectory: false, depth: 2 },
    { path: "src/lib", name: "lib", isDirectory: true, depth: 1 },
    { path: "src/lib/x.ts", name: "x.ts", isDirectory: false, depth: 2 },
  ]);
});

// --- parseBatchCheck (TASK-110) ----------------------------------------------

// `git cat-file --batch-check` writes one line per input, in order, whatever
// happened — and a line that resolved leads with the peeled oid, so the input
// it answers is nowhere in it. Position is the only way back.

const A = "31976f69c26b2181b9e8bc402eff248db6435c88";
const B = "9ceb5a62f7ec749be3a60280970eae131beb310b";

test("parseBatchCheck: a resolved line maps its input to the full oid", () => {
  expect(parseBatchCheck(`${A} commit 514\n`, ["31976f6"])).toEqual({ "31976f6": A });
});

test("parseBatchCheck: missing and ambiguous drop out, and the rest stay aligned", () => {
  // `4f05` is an ambiguous abbreviation: git names the candidates on stderr and
  // writes the same `missing` here, so both look alike from this side.
  const stdout = [
    "deadbeef^{commit} missing",
    `${A} commit 514`,
    "4f05^{commit} missing",
    `${B} commit 773`,
    "",
  ].join("\n");
  expect(parseBatchCheck(stdout, ["deadbeef", "31976f6", "4f05", "9ceb5a6"])).toEqual({
    "31976f6": A,
    "9ceb5a6": B,
  });
});

test("parseBatchCheck: a non-commit object is missing too — ^{commit} will not peel it", () => {
  expect(parseBatchCheck("93eb570^{commit} missing\n", ["93eb570"])).toEqual({});
});

test("parseBatchCheck: output shorter than the input list leaves the rest unanswered", () => {
  expect(parseBatchCheck("", ["31976f6"])).toEqual({});
});
