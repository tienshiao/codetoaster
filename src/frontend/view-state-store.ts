import type { TabType } from "./types/tab";
import type { LineComment } from "./types/diff";
import type { FileInfo } from "./types/file";
import type { GitViewMode } from "./types/git";

export interface FileViewState {
  selectedFile: string | null;
  expandedPaths: Set<string>;
  lineWrap: boolean;
  markdownPreview: boolean;
  scrollTops: Map<string, number>;
}

export interface DiffViewState {
  selectedFile: string | null;
  // Files the user explicitly collapsed in "all" mode. Tracking collapses
  // (rather than expansions) means files newly added to the diff default to
  // expanded, while the user's collapses survive refetches and tab switches.
  collapsedFiles: Set<string>;
  // The user's explicit view-mode toggle; null means "derive from diff size"
  // so the large-diff → single-file default stays live across refetches.
  viewModeOverride: "all" | "single" | null;
  scrollTop: number;
  // Tree directories the user explicitly collapsed (same collapse-tracking
  // rationale as collapsedFiles: new directories default to expanded).
  treeCollapsedPaths: Set<string>;
  comments: Map<string, LineComment>;
}

export interface GitViewState {
  commit?: string;
  mode?: GitViewMode;
  file?: string;
  // Height fraction of the commit-list (top) pane in the draggable split.
  splitRatio: number;
}

export interface SessionViewState {
  lastTab: TabType;
  fileView: FileViewState;
  diffView: DiffViewState;
  gitView: GitViewState;
}

// In-memory only: view state survives tab/session switches but not a page
// reload, where stale selections/scroll offsets would be meaningless anyway.
const store = new Map<string, SessionViewState>();

function createDefault(): SessionViewState {
  return {
    lastTab: "terminal",
    fileView: {
      selectedFile: null,
      expandedPaths: new Set(),
      lineWrap: false,
      markdownPreview: false,
      scrollTops: new Map(),
    },
    diffView: {
      selectedFile: null,
      collapsedFiles: new Set(),
      viewModeOverride: null,
      scrollTop: 0,
      treeCollapsedPaths: new Set(),
      comments: new Map(),
    },
    gitView: {
      commit: undefined,
      mode: undefined,
      file: undefined,
      splitRatio: 0.4,
    },
  };
}

export function getViewState(sessionId: string): SessionViewState {
  let state = store.get(sessionId);
  if (!state) {
    state = createDefault();
    store.set(sessionId, state);
  }
  return state;
}

export function setLastTab(sessionId: string, tab: TabType): void {
  getViewState(sessionId).lastTab = tab;
}

// One coherent mirror of the git view's URL selection into the store, so a
// tab/session switch restores commit + mode + file together (session-nav reads
// all three).
export function setGitViewSelection(
  sessionId: string,
  selection: { commit?: string; mode?: GitViewMode; file?: string },
): void {
  const gitView = getViewState(sessionId).gitView;
  // Only the selection fields are written; splitRatio is left intact so a
  // selection change never resets the pane split.
  gitView.commit = selection.commit;
  gitView.mode = selection.mode;
  gitView.file = selection.file;
}

export function clearViewState(sessionId: string): void {
  store.delete(sessionId);
}

/** Drop view state for sessions no longer present, so entries for sessions
 * that exit on their own or are killed by another client don't leak. */
export function retainViewStates(validIds: Set<string>): void {
  for (const id of store.keys()) {
    if (!validIds.has(id)) store.delete(id);
  }
}

/** Returns `set` unchanged (same reference) when nothing needs pruning, so
 * setState callers can bail out without re-rendering. */
export function pruneSet(set: Set<string>, valid: Set<string>): Set<string> {
  let changed = false;
  const next = new Set<string>();
  for (const item of set) {
    if (valid.has(item)) {
      next.add(item);
    } else {
      changed = true;
    }
  }
  return changed ? next : set;
}

/** Copy of `set` with `value` toggled: removed if present, added if not. */
export function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/** Ancestor directory prefixes of the given paths (e.g. "a/b/c.ts" →
 * {"a", "a/b"}). */
export function collectPathPrefixes(paths: Iterable<string>): Set<string> {
  const dirs = new Set<string>();
  for (const path of paths) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join("/"));
    }
  }
  return dirs;
}

/** All directory paths implied by a file listing: explicit directory entries
 * plus every ancestor prefix of each path. */
export function collectDirectoryPaths(files: FileInfo[]): Set<string> {
  const dirs = collectPathPrefixes(files.map((f) => f.path));
  for (const file of files) {
    if (file.isDirectory) dirs.add(file.path);
  }
  return dirs;
}

/** Returns `comments` unchanged (same reference) when nothing is pruned.
 * A comment is kept when its file is in `validPaths` and, for comments on
 * added/deleted lines, its key is in `validLineKeys` — those line numbers are
 * only meaningful while the hunk they refer to is still in the diff. Context
 * and file-level comments are kept as long as the file is: context lines may
 * live in expanded context that isn't part of the diff data. */
export function pruneComments(
  comments: Map<string, LineComment>,
  validPaths: Set<string>,
  validLineKeys?: Set<string>,
): Map<string, LineComment> {
  let changed = false;
  const next = new Map<string, LineComment>();
  for (const [key, comment] of comments) {
    const lineGone =
      validLineKeys !== undefined &&
      (comment.lineType === "addition" || comment.lineType === "deletion") &&
      !validLineKeys.has(key);
    if (validPaths.has(comment.filePath) && !lineGone) {
      next.set(key, comment);
    } else {
      changed = true;
    }
  }
  return changed ? next : comments;
}
