import { test, expect } from "bun:test";
import {
  getViewState,
  setLastTab,
  clearViewState,
  retainViewStates,
  pruneSet,
  pruneComments,
  collectDirectoryPaths,
  collectPathPrefixes,
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
