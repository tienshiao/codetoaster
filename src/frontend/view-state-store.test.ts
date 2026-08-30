import { test, expect } from "bun:test";

// The store reads `localStorage` lazily, so a stand-in installed here is in
// place by the time any test calls into it.
if (typeof globalThis.localStorage === "undefined") {
  const memory = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return memory.size;
      },
      key: (index: number) => [...memory.keys()][index] ?? null,
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, String(value));
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
      clear: () => {
        memory.clear();
      },
    } as Storage,
  });
}

import {
  viewRef,
  getViewState,
  setViewField,
  subscribeViewField,
  touchViewState,
  clearViewState,
  retainViewStates,
  retainTaskViewStates,
  dropTaskViewStates,
  flushViewStates,
  resetViewStates,
  pruneSet,
  pruneMap,
  pruneComments,
  collectDirectoryPaths,
  collectPathPrefixes,
  toggleInSet,
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

const storageKey = (taskId: string) => `codetoaster:viewstate:${taskId}`;

const storedBlob = (taskId: string) => localStorage.getItem(storageKey(taskId));

/** Simulate a page reload: flush pending saves, drop the in-memory copy, and
 * put the serialized blob back so the next read has to hydrate it. */
function reload(taskId: string): string {
  flushViewStates();
  const raw = storedBlob(taskId);
  resetViewStates(taskId);
  if (raw !== null) localStorage.setItem(storageKey(taskId), raw);
  return raw ?? "";
}

// ── keying ──────────────────────────────────────────────────────────────────

test("getViewState returns the same slot for the same task and key", () => {
  const ref = viewRef("key-same", "diffAll");
  const state = getViewState("diffAll", ref);
  state.scrollTop = 120;
  expect(getViewState("diffAll", ref)).toBe(state);
  expect(getViewState("diffAll", viewRef("key-same", "diffAll")).scrollTop).toBe(120);
  resetViewStates("key-same");
});

test("two view keys in one task get independent slots", () => {
  const task = "key-tabs";
  const all = getViewState("diffAll", viewRef(task, "diffAll"));
  const one = getViewState("diffFile", viewRef(task, "diff:src/a.ts"));
  const other = getViewState("diffFile", viewRef(task, "diff:src/b.ts"));
  all.scrollTop = 10;
  one.scrollTop = 20;
  other.scrollTop = 30;
  expect(getViewState("diffAll", viewRef(task, "diffAll")).scrollTop).toBe(10);
  expect(getViewState("diffFile", viewRef(task, "diff:src/a.ts")).scrollTop).toBe(20);
  expect(getViewState("diffFile", viewRef(task, "diff:src/b.ts")).scrollTop).toBe(30);
  resetViewStates(task);
});

test("the same view key under two tasks does not collide", () => {
  const a = viewRef("key-task-a", "diffAll");
  const b = viewRef("key-task-b", "diffAll");
  setViewField("diffAll", a, "selectedFile", "src/a.ts");
  setViewField("diffAll", b, "selectedFile", "src/b.ts");
  getViewState("diffAll", a).collapsedFiles.add("src/a.ts");
  expect(getViewState("diffAll", a).selectedFile).toBe("src/a.ts");
  expect(getViewState("diffAll", b).selectedFile).toBe("src/b.ts");
  expect(getViewState("diffAll", b).collapsedFiles.size).toBe(0);
  expect(getViewState("diffAll", b)).not.toBe(getViewState("diffAll", a));
  resetViewStates("key-task-a");
  resetViewStates("key-task-b");
});

// ── defaults ────────────────────────────────────────────────────────────────

test("every slot kind starts at its defaults", () => {
  const task = "defaults";
  const at = (key: string) => viewRef(task, key);

  const diffAll = getViewState("diffAll", at("diffAll"));
  expect(diffAll.selectedFile).toBe(null);
  expect(diffAll.viewModeOverride).toBe(null);
  expect(diffAll.scrollTop).toBe(0);
  expect(diffAll.collapsedFiles).toBeInstanceOf(Set);
  expect(diffAll.collapsedFiles.size).toBe(0);
  expect(diffAll.treeCollapsedPaths.size).toBe(0);
  expect(diffAll.hunkExpansions).toBeInstanceOf(Map);
  expect(diffAll.hunkExpansions.size).toBe(0);

  const diffFile = getViewState("diffFile", at("diff:src/a.ts"));
  expect(diffFile.scrollTop).toBe(0);
  expect(diffFile.hunkExpansions).toBeInstanceOf(Map);
  expect(diffFile.hunkExpansions.size).toBe(0);

  const file = getViewState("file", at("file:src/a.ts"));
  expect(file.lineWrap).toBe(false);
  expect(file.markdownPreview).toBe(false);
  expect(file.scrollTops).toBeInstanceOf(Map);
  expect(file.scrollTops.size).toBe(0);

  const commit = getViewState("commit", at("commit:abc123"));
  expect(commit.mode).toBe("commit");
  expect(commit.file).toBe(null);
  expect(commit.commitExpandedPaths.size).toBe(0);
  expect(commit.changesSelectedFile).toBe(null);
  expect(commit.changesCollapsedFiles.size).toBe(0);
  expect(commit.changesViewModeOverride).toBe(null);
  expect(commit.changesTreeCollapsedPaths.size).toBe(0);
  expect(commit.changesScrollTop).toBe(0);
  expect(commit.treeExpandedPaths.size).toBe(0);

  const history = getViewState("history", at("history"));
  expect(history.refsClosedSections).toBeInstanceOf(Set);
  expect(history.refsClosedSections.size).toBe(0);
  expect(history.refsHeadExpandedFor).toBe(null);
  expect(history.refsExpanded).toBeInstanceOf(Map);
  expect(history.refsExpanded.size).toBe(0);
  expect(history.listScrollTop).toBe(0);
  expect(history.splitRatio).toBe(0.4);

  const review = getViewState("review", at("review"));
  expect(review.comments).toBeInstanceOf(Map);
  expect(review.comments.size).toBe(0);

  const files = getViewState("files", at("files"));
  expect(files.selectedFile).toBe(null);
  expect(files.expandedPaths).toBeInstanceOf(Set);
  expect(files.expandedPaths.size).toBe(0);

  expect(getViewState("prefs", at("prefs")).treeLineWrap).toBe(false);

  resetViewStates(task);
});

test("fresh slots never share a Set or Map instance", () => {
  const a = getViewState("diffAll", viewRef("share-a", "diffAll"));
  const b = getViewState("diffAll", viewRef("share-b", "diffAll"));
  expect(b.collapsedFiles).not.toBe(a.collapsedFiles);
  expect(b.treeCollapsedPaths).not.toBe(a.treeCollapsedPaths);
  expect(b.hunkExpansions).not.toBe(a.hunkExpansions);
  a.collapsedFiles.add("src/a.ts");
  a.hunkExpansions.set("src/a.ts:0", {
    beforeLines: [],
    afterLines: [],
    canExpandBefore: false,
    canExpandAfter: false,
  });
  expect(b.collapsedFiles.size).toBe(0);
  expect(b.hunkExpansions.size).toBe(0);

  const reviewA = getViewState("review", viewRef("share-a", "review"));
  const reviewB = getViewState("review", viewRef("share-b", "review"));
  expect(reviewB.comments).not.toBe(reviewA.comments);

  const historyA = getViewState("history", viewRef("share-a", "history"));
  const historyB = getViewState("history", viewRef("share-b", "history"));
  expect(historyB.refsExpanded).not.toBe(historyA.refsExpanded);
  expect(historyB.refsClosedSections).not.toBe(historyA.refsClosedSections);

  resetViewStates("share-a");
  resetViewStates("share-b");
});

// ── pruning ─────────────────────────────────────────────────────────────────

test("retainViewStates drops tab slots whose key is gone and keeps the rest", () => {
  const task = "prune-tabs";
  setViewField("diffAll", viewRef(task, "diffAll"), "scrollTop", 10);
  setViewField("diffFile", viewRef(task, "diff:src/a.ts"), "scrollTop", 20);
  setViewField("file", viewRef(task, "file:src/a.ts"), "lineWrap", true);
  setViewField("commit", viewRef(task, "commit:abc123"), "changesScrollTop", 30);
  setViewField("history", viewRef(task, "history"), "listScrollTop", 40);

  retainViewStates(task, new Set(["diffAll", "commit:abc123"]));

  expect(getViewState("diffAll", viewRef(task, "diffAll")).scrollTop).toBe(10);
  expect(getViewState("commit", viewRef(task, "commit:abc123")).changesScrollTop).toBe(30);
  expect(getViewState("diffFile", viewRef(task, "diff:src/a.ts")).scrollTop).toBe(0);
  expect(getViewState("file", viewRef(task, "file:src/a.ts")).lineWrap).toBe(false);
  expect(getViewState("history", viewRef(task, "history")).listScrollTop).toBe(0);
  resetViewStates(task);
});

test("retainViewStates keeps the review when its diff tab closes", () => {
  const task = "prune-review";
  const review = viewRef(task, "review");
  getViewState("review", review).comments.set("src/a.ts:1:addition", makeComment("src/a.ts"));
  touchViewState(review);
  setViewField("diffFile", viewRef(task, "diff:src/a.ts"), "scrollTop", 40);

  retainViewStates(task, new Set());

  expect(getViewState("review", review).comments.size).toBe(1);
  expect(getViewState("diffFile", viewRef(task, "diff:src/a.ts")).scrollTop).toBe(0);
  resetViewStates(task);
});

test("retainViewStates never prunes the files and prefs slots", () => {
  const task = "prune-nontabs";
  setViewField("files", viewRef(task, "files"), "selectedFile", "src/a.ts");
  setViewField("prefs", viewRef(task, "prefs"), "treeLineWrap", true);

  retainViewStates(task, new Set());

  expect(getViewState("files", viewRef(task, "files")).selectedFile).toBe("src/a.ts");
  expect(getViewState("prefs", viewRef(task, "prefs")).treeLineWrap).toBe(true);
  resetViewStates(task);
});

test("retainViewStates leaves another task's slots alone", () => {
  setViewField("diffAll", viewRef("prune-a", "diffAll"), "scrollTop", 11);
  setViewField("diffAll", viewRef("prune-b", "diffAll"), "scrollTop", 22);
  retainViewStates("prune-a", new Set());
  expect(getViewState("diffAll", viewRef("prune-a", "diffAll")).scrollTop).toBe(0);
  expect(getViewState("diffAll", viewRef("prune-b", "diffAll")).scrollTop).toBe(22);
  resetViewStates("prune-a");
  resetViewStates("prune-b");
});

test("clearViewState resets one slot without touching its siblings", () => {
  const task = "clear-one";
  setViewField("diffAll", viewRef(task, "diffAll"), "scrollTop", 10);
  setViewField("prefs", viewRef(task, "prefs"), "treeLineWrap", true);
  clearViewState(viewRef(task, "diffAll"));
  expect(getViewState("diffAll", viewRef(task, "diffAll")).scrollTop).toBe(0);
  expect(getViewState("prefs", viewRef(task, "prefs")).treeLineWrap).toBe(true);
  resetViewStates(task);
});

test("dropTaskViewStates forgets the task in memory and in storage", () => {
  const task = "drop-task";
  setViewField("diffAll", viewRef(task, "diffAll"), "scrollTop", 15);
  setViewField("review", viewRef(task, "review"), "comments", new Map());
  flushViewStates();
  expect(storedBlob(task)).not.toBeNull();

  dropTaskViewStates(task);

  expect(storedBlob(task)).toBeNull();
  expect(getViewState("diffAll", viewRef(task, "diffAll")).scrollTop).toBe(0);
  resetViewStates(task);
});

test("retainTaskViewStates forgets tasks no longer in the list", () => {
  setViewField("prefs", viewRef("task-alive", "prefs"), "treeLineWrap", true);
  setViewField("prefs", viewRef("task-gone", "prefs"), "treeLineWrap", true);
  retainTaskViewStates(new Set(["task-alive"]));
  expect(getViewState("prefs", viewRef("task-alive", "prefs")).treeLineWrap).toBe(true);
  expect(getViewState("prefs", viewRef("task-gone", "prefs")).treeLineWrap).toBe(false);
  resetViewStates("task-alive");
  resetViewStates("task-gone");
});

// ── persistence ─────────────────────────────────────────────────────────────

test("flushViewStates writes before the debounce elapses", () => {
  const task = "persist-flush";
  setViewField("prefs", viewRef(task, "prefs"), "treeLineWrap", true);
  expect(storedBlob(task)).toBeNull();
  flushViewStates();
  expect(storedBlob(task)).not.toBeNull();
  resetViewStates(task);
});

test("a written slot comes back after a reload", () => {
  const task = "persist-scalar";
  setViewField("diffFile", viewRef(task, "diff:src/a.ts"), "scrollTop", 320);
  setViewField("commit", viewRef(task, "commit:abc123"), "mode", "changes");
  setViewField("prefs", viewRef(task, "prefs"), "treeLineWrap", true);

  reload(task);

  expect(getViewState("diffFile", viewRef(task, "diff:src/a.ts")).scrollTop).toBe(320);
  expect(getViewState("commit", viewRef(task, "commit:abc123")).mode).toBe("changes");
  expect(getViewState("prefs", viewRef(task, "prefs")).treeLineWrap).toBe(true);
  resetViewStates(task);
});

test("Sets and Maps survive the round trip as Sets and Maps", () => {
  const task = "persist-collections";
  const diff = viewRef(task, "diffAll");
  const file = viewRef(task, "file:README.md");
  const state = getViewState("diffAll", diff);
  state.collapsedFiles.add("src/a.ts");
  state.treeCollapsedPaths.add("src");
  touchViewState(diff);
  getViewState("file", file).scrollTops.set("source", 88);
  touchViewState(file);

  reload(task);

  const revived = getViewState("diffAll", diff);
  expect(revived.collapsedFiles).toBeInstanceOf(Set);
  expect([...revived.collapsedFiles]).toEqual(["src/a.ts"]);
  expect(revived.treeCollapsedPaths).toBeInstanceOf(Set);
  expect([...revived.treeCollapsedPaths]).toEqual(["src"]);
  const revivedFile = getViewState("file", file);
  expect(revivedFile.scrollTops).toBeInstanceOf(Map);
  expect(revivedFile.scrollTops.get("source")).toBe(88);
  resetViewStates(task);
});

test("the history slot's nested refsExpanded comes back as a Map of Sets", () => {
  const task = "persist-history";
  const ref = viewRef(task, "history");
  const state = getViewState("history", ref);
  state.refsExpanded.set("Local", new Set(["feature", "feature/ui"]));
  state.refsExpanded.set("Remotes", new Set());
  state.refsClosedSections.add("Tags");
  state.refsHeadExpandedFor = "main";
  state.listScrollTop = 640;
  touchViewState(ref);

  reload(task);

  const revived = getViewState("history", ref);
  expect(revived.refsExpanded).toBeInstanceOf(Map);
  expect([...revived.refsExpanded.keys()].sort()).toEqual(["Local", "Remotes"]);
  const local = revived.refsExpanded.get("Local");
  expect(local).toBeInstanceOf(Set);
  expect([...local!].sort()).toEqual(["feature", "feature/ui"]);
  expect(revived.refsExpanded.get("Remotes")).toBeInstanceOf(Set);
  expect([...revived.refsClosedSections]).toEqual(["Tags"]);
  expect(revived.refsHeadExpandedFor).toBe("main");
  expect(revived.listScrollTop).toBe(640);
  resetViewStates(task);
});

test("an unsubmitted review survives a reload", () => {
  const task = "persist-review";
  const ref = viewRef(task, "review");
  getViewState("review", ref).comments.set("src/a.ts:1:addition", makeComment("src/a.ts"));
  touchViewState(ref);

  reload(task);

  const revived = getViewState("review", ref);
  expect(revived.comments).toBeInstanceOf(Map);
  expect(revived.comments.size).toBe(1);
  expect(revived.comments.get("src/a.ts:1:addition")?.content).toBe("note");
  expect(revived.comments.get("src/a.ts:1:addition")?.filePath).toBe("src/a.ts");
  resetViewStates(task);
});

test("hunkExpansions is left out of the stored blob and comes back empty", () => {
  const task = "persist-hunks";
  const all = viewRef(task, "diffAll");
  const one = viewRef(task, "diff:src/a.ts");
  const expansion = {
    beforeLines: [{ type: "context" as const, content: "untouched line" }],
    afterLines: [],
    canExpandBefore: true,
    canExpandAfter: false,
  };
  const allState = getViewState("diffAll", all);
  allState.scrollTop = 12;
  allState.hunkExpansions.set("src/a.ts:0", expansion);
  touchViewState(all);
  const oneState = getViewState("diffFile", one);
  oneState.scrollTop = 34;
  oneState.hunkExpansions.set("src/a.ts:0", expansion);
  touchViewState(one);

  const raw = reload(task);

  expect(raw).toContain("scrollTop");
  expect(raw).not.toContain("hunkExpansions");
  expect(raw).not.toContain("canExpandBefore");
  expect(raw).not.toContain("untouched line");

  const revivedAll = getViewState("diffAll", all);
  expect(revivedAll.scrollTop).toBe(12);
  expect(revivedAll.hunkExpansions).toBeInstanceOf(Map);
  expect(revivedAll.hunkExpansions.size).toBe(0);
  const revivedOne = getViewState("diffFile", one);
  expect(revivedOne.scrollTop).toBe(34);
  expect(revivedOne.hunkExpansions.size).toBe(0);
  resetViewStates(task);
});

test("a field added since the entry was written hydrates to its default", () => {
  const task = "persist-older-shape";
  resetViewStates(task);
  localStorage.setItem(
    storageKey(task),
    JSON.stringify({
      "file:src/a.ts": { kind: "file", state: { lineWrap: true } },
      history: { kind: "history", state: { listScrollTop: 90 } },
    }),
  );

  const file = getViewState("file", viewRef(task, "file:src/a.ts"));
  expect(file.lineWrap).toBe(true);
  expect(file.markdownPreview).toBe(false);
  expect(file.scrollTops).toBeInstanceOf(Map);
  expect(file.scrollTops.size).toBe(0);

  const history = getViewState("history", viewRef(task, "history"));
  expect(history.listScrollTop).toBe(90);
  expect(history.splitRatio).toBe(0.4);
  expect(history.refsExpanded).toBeInstanceOf(Map);
  expect(history.refsClosedSections).toBeInstanceOf(Set);
  resetViewStates(task);
});

test("a key stored under the wrong kind starts at the requested kind's defaults", () => {
  const task = "persist-wrong-kind";
  resetViewStates(task);
  localStorage.setItem(
    storageKey(task),
    JSON.stringify({
      diffAll: { kind: "file", state: { lineWrap: true, markdownPreview: true } },
    }),
  );

  const state = getViewState("diffAll", viewRef(task, "diffAll"));

  expect(state.selectedFile).toBe(null);
  expect(state.viewModeOverride).toBe(null);
  expect(state.scrollTop).toBe(0);
  expect(state.collapsedFiles).toBeInstanceOf(Set);
  expect(state.collapsedFiles.size).toBe(0);
  expect(state.hunkExpansions).toBeInstanceOf(Map);
  expect("lineWrap" in state).toBe(false);
  expect("markdownPreview" in state).toBe(false);
  expect(getViewState("diffAll", viewRef(task, "diffAll"))).toBe(state);
  resetViewStates(task);
});

test("a malformed entry starts the task at its defaults", () => {
  const task = "persist-malformed";
  resetViewStates(task);
  localStorage.setItem(storageKey(task), "{not json at all");
  const state = getViewState("diffAll", viewRef(task, "diffAll"));
  expect(state.scrollTop).toBe(0);
  expect(state.selectedFile).toBe(null);
  expect(state.collapsedFiles.size).toBe(0);
  resetViewStates(task);
});

test("an unknown slot kind is ignored without losing its neighbours", () => {
  const task = "persist-unknown-kind";
  resetViewStates(task);
  localStorage.setItem(
    storageKey(task),
    JSON.stringify({
      hologram: { kind: "hologram", state: { anything: 1 } },
      diffAll: { kind: "diffAll", state: { scrollTop: 5 } },
    }),
  );

  expect(getViewState("diffAll", viewRef(task, "diffAll")).scrollTop).toBe(5);
  expect(getViewState("prefs", viewRef(task, "hologram")).treeLineWrap).toBe(false);
  resetViewStates(task);
});

// ── a task nobody has read yet ───────────────────────────────────────────────
//
// A task is not hydrated until one of its views is first read, so every
// function below can be the first thing to touch it and must reach storage
// rather than only memory.

test("a save scheduled before the task is read does not erase its stored slots", () => {
  const task = "unread-save";
  resetViewStates(task);
  localStorage.setItem(
    storageKey(task),
    JSON.stringify({ diffAll: { kind: "diffAll", state: { scrollTop: 99 } } }),
  );

  touchViewState(viewRef(task, "diffAll"));
  flushViewStates();

  expect(storedBlob(task)).not.toBeNull();
  expect(getViewState("diffAll", viewRef(task, "diffAll")).scrollTop).toBe(99);
  resetViewStates(task);
});

test("retainTaskViewStates sweeps a dead task that exists only in storage", () => {
  const dead = "unread-dead";
  const alive = "unread-alive";
  resetViewStates(dead);
  resetViewStates(alive);
  localStorage.setItem(
    storageKey(dead),
    JSON.stringify({ diffAll: { kind: "diffAll", state: { scrollTop: 7 } } }),
  );
  localStorage.setItem(
    storageKey(alive),
    JSON.stringify({ diffAll: { kind: "diffAll", state: { scrollTop: 8 } } }),
  );
  const enumerated = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
  expect(enumerated).toContain(storageKey(dead));

  retainTaskViewStates(new Set([alive]));

  expect(storedBlob(dead)).toBeNull();
  expect(storedBlob(alive)).not.toBeNull();
  expect(getViewState("diffAll", viewRef(dead, "diffAll")).scrollTop).toBe(0);
  expect(getViewState("diffAll", viewRef(alive, "diffAll")).scrollTop).toBe(8);
  resetViewStates(dead);
  resetViewStates(alive);
});

test("clearViewState drops a slot that exists only in storage", () => {
  const task = "unread-clear";
  resetViewStates(task);
  localStorage.setItem(
    storageKey(task),
    JSON.stringify({
      diffAll: { kind: "diffAll", state: { scrollTop: 55 } },
      prefs: { kind: "prefs", state: { treeLineWrap: true } },
    }),
  );

  clearViewState(viewRef(task, "diffAll"));
  flushViewStates();

  const raw = storedBlob(task) ?? "";
  expect(raw).not.toContain("diffAll");
  expect(raw).toContain("prefs");
  expect(getViewState("diffAll", viewRef(task, "diffAll")).scrollTop).toBe(0);
  expect(getViewState("prefs", viewRef(task, "prefs")).treeLineWrap).toBe(true);
  resetViewStates(task);
});

test("retainViewStates prunes a stored tab when it is the first call to touch the task", () => {
  const task = "unread-retain";
  resetViewStates(task);
  localStorage.setItem(
    storageKey(task),
    JSON.stringify({
      "diff:src/kept.ts": { kind: "diffFile", state: { scrollTop: 11 } },
      "diff:src/closed.ts": { kind: "diffFile", state: { scrollTop: 22 } },
      review: {
        kind: "review",
        state: { comments: { __map: [["src/kept.ts:1:addition", makeComment("src/kept.ts")]] } },
      },
      files: {
        kind: "files",
        state: { selectedFile: "src/kept.ts", expandedPaths: { __set: ["src"] } },
      },
      prefs: { kind: "prefs", state: { treeLineWrap: true } },
    }),
  );

  retainViewStates(task, new Set(["diff:src/kept.ts"]));
  flushViewStates();

  const raw = storedBlob(task) ?? "";
  expect(raw).toContain("diff:src/kept.ts");
  expect(raw).not.toContain("diff:src/closed.ts");
  expect(getViewState("diffFile", viewRef(task, "diff:src/kept.ts")).scrollTop).toBe(11);
  expect(getViewState("diffFile", viewRef(task, "diff:src/closed.ts")).scrollTop).toBe(0);
  expect(getViewState("review", viewRef(task, "review")).comments.size).toBe(1);
  const files = getViewState("files", viewRef(task, "files"));
  expect(files.selectedFile).toBe("src/kept.ts");
  expect([...files.expandedPaths]).toEqual(["src"]);
  expect(getViewState("prefs", viewRef(task, "prefs")).treeLineWrap).toBe(true);
  resetViewStates(task);
});

// ── helpers ─────────────────────────────────────────────────────────────────

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

// ── notification ────────────────────────────────────────────────────────────
//
// Two panes can be bound to one slot at once — a split showing the all-files
// diff beside a single file of it addresses the same task-wide `review` — and
// each holds its own React copy. The signal is what keeps the second write from
// being computed against a copy taken before the first.

test("a write wakes the field's subscribers, and only that field's", () => {
  const task = "notify";
  const ref = viewRef(task, "review");
  const seen: number[] = [];
  const unsubscribe = subscribeViewField(ref, "comments", () => {
    seen.push(getViewState("review", ref).comments.size);
  });
  const other: string[] = [];
  const unsubscribeOther = subscribeViewField(viewRef(task, "diffAll"), "scrollTop", () =>
    other.push("woken"),
  );

  const one = new Map([["src/a.ts:1:addition", makeComment("src/a.ts")]]);
  setViewField("review", ref, "comments", one);
  expect(seen).toEqual([1]);
  expect(other).toEqual([]);

  // A neighbouring field of the same slot is a different signal.
  setViewField("history", viewRef(task, "history"), "listScrollTop", 40);
  expect(seen).toEqual([1]);

  unsubscribe();
  setViewField("review", ref, "comments", new Map());
  expect(seen).toEqual([1]);
  unsubscribeOther();
  resetViewStates(task);
});

// ── helpers, continued ──────────────────────────────────────────────────────

test("collectPathPrefixes returns ancestor directories of file paths", () => {
  const dirs = collectPathPrefixes(["a/b/c.ts", "a/d.ts", "top.ts"]);
  expect([...dirs].sort()).toEqual(["a", "a/b"]);
});

test("toggleInSet adds a missing value, removes a present one, and copies", () => {
  const base = new Set(["a", "b"]);
  expect([...toggleInSet(base, "c")].sort()).toEqual(["a", "b", "c"]);
  expect([...toggleInSet(base, "a")]).toEqual(["b"]);
  expect([...base].sort()).toEqual(["a", "b"]);
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
