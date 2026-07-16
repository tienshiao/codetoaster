import { test, expect } from "bun:test";
import {
  getViewState,
  gitDetailState,
  peekGitDetailState,
  setLastTab,
  clearViewState,
  retainViewStates,
  pruneSet,
  pruneMap,
  pruneComments,
  collectDirectoryPaths,
  collectPathPrefixes,
  withAll,
  withoutAll,
} from "./view-state-store";
import type { LineComment } from "./types/diff";
import type { FileInfo } from "./types/file";

function makeComment(filePath: string): LineComment {
  return {
    id: filePath,
    filePath,
    lineNumber: 1,
    lineType: "addition",
    hunkIndex: 0,
    content: "note",
    createdAt: 0,
    updatedAt: 0,
  };
}

test("getViewState creates defaults and returns the same state per session", () => {
  clearViewState("s1");
  const state = getViewState("s1");
  expect(state.lastTab).toBe("terminal");
  expect(state.diffView.viewModeOverride).toBe(null);
  expect(state.diffView.collapsedFiles.size).toBe(0);
  expect(getViewState("s1")).toBe(state);
  clearViewState("s1");
});

test("retainViewStates drops entries for sessions no longer present", () => {
  clearViewState("keep");
  clearViewState("drop");
  setLastTab("keep", "diff");
  setLastTab("drop", "file");
  retainViewStates(new Set(["keep"]));
  // "keep" retains its tab; "drop" was evicted and re-defaults
  expect(getViewState("keep").lastTab).toBe("diff");
  expect(getViewState("drop").lastTab).toBe("terminal");
  clearViewState("keep");
  clearViewState("drop");
});

test("setLastTab and clearViewState", () => {
  setLastTab("s2", "diff");
  expect(getViewState("s2").lastTab).toBe("diff");
  clearViewState("s2");
  expect(getViewState("s2").lastTab).toBe("terminal");
  clearViewState("s2");
});

test("pruneSet removes stale entries", () => {
  const set = new Set(["a", "b/c", "d"]);
  const pruned = pruneSet(set, new Set(["a", "d"]));
  expect([...pruned].sort()).toEqual(["a", "d"]);
});

test("pruneSet returns the same reference when nothing changes", () => {
  const set = new Set(["a", "b"]);
  expect(pruneSet(set, new Set(["a", "b", "c"]))).toBe(set);
});

test("pruneComments drops comments for files outside the diff", () => {
  const comments = new Map([
    ["src/a.ts:1:addition", makeComment("src/a.ts")],
    ["src/b.ts:file-level", makeComment("src/b.ts")],
  ]);
  const pruned = pruneComments(comments, new Set(["src/a.ts"]));
  expect(pruned.size).toBe(1);
  expect(pruned.has("src/a.ts:1:addition")).toBe(true);
});

test("pruneComments returns the same reference when nothing changes", () => {
  const comments = new Map([["src/a.ts:1:addition", makeComment("src/a.ts")]]);
  expect(pruneComments(comments, new Set(["src/a.ts"]))).toBe(comments);
});

test("pruneComments drops addition/deletion comments whose line left the diff", () => {
  const comments = new Map<string, LineComment>([
    ["src/a.ts:1:addition", makeComment("src/a.ts")],
    ["src/a.ts:9:deletion", { ...makeComment("src/a.ts"), lineNumber: 9, lineType: "deletion" }],
    ["src/a.ts:5:context", { ...makeComment("src/a.ts"), lineNumber: 5, lineType: "context" }],
    ["src/a.ts:file-level", { ...makeComment("src/a.ts"), lineNumber: undefined, lineType: "file" }],
  ]);
  const validPaths = new Set(["src/a.ts"]);
  const validLineKeys = new Set(["src/a.ts:1:addition"]);
  const pruned = pruneComments(comments, validPaths, validLineKeys);
  // the deletion comment's line left the diff; context/file-level survive
  expect([...pruned.keys()].sort()).toEqual([
    "src/a.ts:1:addition",
    "src/a.ts:5:context",
    "src/a.ts:file-level",
  ]);
});

test("pruneComments without line keys prunes by file path only", () => {
  const comments = new Map([["src/a.ts:9:deletion", { ...makeComment("src/a.ts"), lineNumber: 9, lineType: "deletion" as const }]]);
  expect(pruneComments(comments, new Set(["src/a.ts"]))).toBe(comments);
});

test("collectDirectoryPaths includes explicit dirs and ancestor prefixes", () => {
  const files: FileInfo[] = [
    { path: "src/lib/util.ts", name: "util.ts", isDirectory: false, depth: 2 },
    { path: "docs", name: "docs", isDirectory: true, depth: 0 },
  ];
  const dirs = collectDirectoryPaths(files);
  expect(dirs.has("src")).toBe(true);
  expect(dirs.has("src/lib")).toBe(true);
  expect(dirs.has("docs")).toBe(true);
  expect(dirs.has("src/lib/util.ts")).toBe(false);
});

test("collectPathPrefixes returns ancestor directories of file paths", () => {
  const dirs = collectPathPrefixes(["a/b/c.ts", "a/d.ts", "top.ts"]);
  expect([...dirs].sort()).toEqual(["a", "a/b"]);
});

test("createDefault includes the new diff/git view-state fields", () => {
  clearViewState("defaults");
  const state = getViewState("defaults");
  expect(state.diffView.hunkExpansions instanceof Map).toBe(true);
  expect(state.diffView.hunkExpansions.size).toBe(0);
  const git = state.gitView;
  expect(git.refsClosedSections instanceof Set).toBe(true);
  expect(git.refsClosedSections.size).toBe(0);
  expect(git.refsExpanded instanceof Map).toBe(true);
  expect(git.refsExpanded.size).toBe(0);
  expect(git.listScrollTop).toBe(0);
  expect(git.treeLineWrap).toBe(false);
  expect(git.detail.sha).toBe(null);
  clearViewState("defaults");
});

test("gitDetailState returns the same object for the same sha, retaining mutations", () => {
  clearViewState("gd");
  const detail = gitDetailState("gd", "abc123");
  expect(detail.sha).toBe("abc123");
  detail.commitExpandedPaths.add("src/foo.ts");
  detail.changesSelectedFile = "src/bar.ts";
  detail.changesScrollTop = 42;
  const again = gitDetailState("gd", "abc123");
  expect(again).toBe(detail);
  expect(again.commitExpandedPaths.has("src/foo.ts")).toBe(true);
  expect(again.changesSelectedFile).toBe("src/bar.ts");
  expect(again.changesScrollTop).toBe(42);
  clearViewState("gd");
});

test("gitDetailState resets to defaults and restamps when the sha changes", () => {
  clearViewState("gd2");
  const first = gitDetailState("gd2", "sha-one");
  first.commitExpandedPaths.add("a");
  first.changesScrollTop = 99;
  const second = gitDetailState("gd2", "sha-two");
  expect(second).not.toBe(first);
  expect(second.sha).toBe("sha-two");
  expect(second.commitExpandedPaths.size).toBe(0);
  expect(second.changesScrollTop).toBe(0);
  // The single slot now holds sha-two; re-requesting sha-one gives a fresh reset.
  const back = gitDetailState("gd2", "sha-one");
  expect(back).not.toBe(first);
  expect(back.commitExpandedPaths.size).toBe(0);
  clearViewState("gd2");
});

test("peekGitDetailState returns the slot only for the current sha, never resets", () => {
  clearViewState("gd3");
  const detail = gitDetailState("gd3", "sha-one");
  detail.changesScrollTop = 7;
  expect(peekGitDetailState("gd3", "sha-one")).toBe(detail);
  // A stale peek is inert: null result, slot untouched.
  expect(peekGitDetailState("gd3", "sha-other")).toBe(null);
  expect(getViewState("gd3").gitView.detail).toBe(detail);
  expect(detail.changesScrollTop).toBe(7);
  clearViewState("gd3");
});

test("withAll adds missing values and bails out same-reference when none are missing", () => {
  const base = new Set(["a", "b"]);
  expect(withAll(base, ["a", "b"])).toBe(base);
  expect(withAll(base, [])).toBe(base);
  const grown = withAll(base, ["b", "c"]);
  expect(grown).not.toBe(base);
  expect([...grown].sort()).toEqual(["a", "b", "c"]);
  expect(base.has("c")).toBe(false);
});

test("withoutAll removes present values and bails out same-reference when none are present", () => {
  const base = new Set(["a", "b", "c"]);
  expect(withoutAll(base, ["x", "y"])).toBe(base);
  expect(withoutAll(base, [])).toBe(base);
  const shrunk = withoutAll(base, ["a", "x"]);
  expect(shrunk).not.toBe(base);
  expect([...shrunk].sort()).toEqual(["b", "c"]);
  expect(base.has("a")).toBe(true);
});

test("pruneMap drops failing entries and bails out same-reference when all pass", () => {
  const base = new Map([
    ["a:0", 1],
    ["b:1", 2],
  ]);
  expect(pruneMap(base, () => true)).toBe(base);
  const pruned = pruneMap(base, (key) => key.startsWith("a"));
  expect(pruned).not.toBe(base);
  expect([...pruned.keys()]).toEqual(["a:0"]);
});
