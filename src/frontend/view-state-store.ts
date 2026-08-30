// Per-view UI state that survives a tab unmounting (§7.4).
//
// Keyed by **task + view key**, not by session. A view key is almost always a
// `tabKey` from `layout-store` — `diffAll`, `diff:<path>`, `file:<path>`,
// `commit:<sha>`, `history` — so "the state of this tab" and "the identity of
// this tab" are the same string, and closing a tab is the only thing that has
// to happen for its state to be droppable. A handful of keys are not tabs at
// all (`review`, `files`, `prefs`): state that belongs to the task rather than
// to any one pane.
//
// That keying is what lets one component serve two tabs. The old store handed
// out a single blob per session, so the all-files diff and a per-file diff
// could not both exist — there was one `scrollTop` between them. It also
// retires the git detail cache's sha-reset dance: a commit tab's key
// *contains* the sha, so per-commit state is per-key state and needs no
// invalidation at all.
//
// Persistence: the cheap fields go to `localStorage` per task (see
// `PERSISTED`), so a reload keeps selections, toggles, scroll offsets and an
// unsubmitted review. `hunkExpansions` deliberately does not: it holds fetched
// diff *lines*, it is large, and it is only valid against the diff it was
// fetched for — restoring it stale is exactly the corruption the diff view's
// prune effect exists to prevent. It is left out of `PERSISTED` rather than
// filtered on the way out, so it cannot be added back by accident.

import type { TabType } from "./types/tab";
import type { LineComment, HunkExpansionState } from "./types/diff";
import type { FileInfo } from "./types/file";
import type { GitViewMode } from "./types/git";

// ── slot shapes ─────────────────────────────────────────────────────────────

/** `diffAll`: the whole working-tree diff. */
export interface DiffAllViewState {
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
  // Loaded expanded-context lines, keyed by `${filePath}:${hunkIndex}` (see
  // DiffFile). Survives refetches while the file stays in the diff.
  hunkExpansions: Map<string, HunkExpansionState>;
}

/** `diff:<path>`: one file of the working-tree diff. No tree, no view-mode
 * toggle, no per-file collapse — the tab *is* the file. */
export interface DiffFileViewState {
  scrollTop: number;
  hunkExpansions: Map<string, HunkExpansionState>;
}

/** `file:<path>`. Wrap and preview are per-editor, the way an editor's own
 * word-wrap toggle is; `scrollTops` is keyed by mode because source and
 * rendered markdown have unrelated content heights. */
export interface FileViewState {
  lineWrap: boolean;
  markdownPreview: boolean;
  scrollTops: Map<string, number>;
}

/** `commit:<sha>`. Everything the old `GitDetailViewState` held, minus the
 * `sha` field that existed only to detect a stale cache slot. */
export interface CommitViewState {
  mode: GitViewMode;
  /** Tree-mode selected path. */
  file: string | null;
  commitExpandedPaths: Set<string>;
  changesSelectedFile: string | null;
  changesCollapsedFiles: Set<string>;
  changesViewModeOverride: "all" | "single" | null;
  changesTreeCollapsedPaths: Set<string>;
  changesScrollTop: number;
  treeExpandedPaths: Set<string>;
}

/** `history`: the commit graph and the ref sidebar beside it. */
export interface HistoryViewState {
  // RefSidebar section titles the user closed (sections default open).
  refsClosedSections: Set<string>;
  // HEAD branch whose ancestor folders were last auto-expanded, so the reveal
  // runs once per checkout instead of on every remount (which would undo a
  // user's collapse of those folders on every tab switch).
  refsHeadExpandedFor: string | null;
  // Expanded ref folder paths, keyed by section title so identically-named
  // folders in different sections (a local branch "origin/foo" vs a remote)
  // never share a namespace.
  refsExpanded: Map<string, Set<string>>;
  // CommitList scroll offset (px).
  listScrollTop: number;
  /** v1 only: height fraction of the commit-list pane in the old git route's
   * draggable split. v2 has no split here — the graph and a commit are two
   * tabs — so this dies with `sessions.$slug.git.tsx` in TASK-21. */
  splitRatio: number;
}

/** `review`: the task's draft review. Not a tab. Comments left on a
 * `diff:<path>` tab and comments left on `diffAll` are one review, and Submit
 * gathers both — keyed per tab, half of a review would silently vanish on the
 * way to the prompt. */
export interface ReviewViewState {
  comments: Map<string, LineComment>;
}

/** `files`: the Explorer's file tree. Not a tab; the tree is chrome that
 * outlives whichever file tab it opened. TASK-26 grows this. */
export interface FilesViewState {
  selectedFile: string | null;
  expandedPaths: Set<string>;
}

/** `prefs`: task-wide toggles that are a preference rather than a view's own
 * state, and so must not be re-answered per tab. */
export interface PrefsViewState {
  /** Word wrap in a commit's tree mode. */
  treeLineWrap: boolean;
}

/** `nav`: v1 only. `utils/session-nav.ts` reconstructs a route from the last
 * tab and the git route's URL selection; TASK-21 deletes that file and this
 * slot with it. Nothing in v2 reads it. */
export interface NavViewState {
  lastTab: TabType;
  gitCommit: string | undefined;
  gitMode: GitViewMode | undefined;
  gitFile: string | undefined;
}

export interface ViewStateShapes {
  diffAll: DiffAllViewState;
  diffFile: DiffFileViewState;
  file: FileViewState;
  commit: CommitViewState;
  history: HistoryViewState;
  review: ReviewViewState;
  files: FilesViewState;
  prefs: PrefsViewState;
  nav: NavViewState;
}

export type ViewSlotKind = keyof ViewStateShapes;

const DEFAULTS: { [K in ViewSlotKind]: () => ViewStateShapes[K] } = {
  diffAll: () => ({
    selectedFile: null,
    collapsedFiles: new Set(),
    viewModeOverride: null,
    scrollTop: 0,
    treeCollapsedPaths: new Set(),
    hunkExpansions: new Map(),
  }),
  diffFile: () => ({ scrollTop: 0, hunkExpansions: new Map() }),
  file: () => ({ lineWrap: false, markdownPreview: false, scrollTops: new Map() }),
  commit: () => ({
    mode: "commit",
    file: null,
    commitExpandedPaths: new Set(),
    changesSelectedFile: null,
    changesCollapsedFiles: new Set(),
    changesViewModeOverride: null,
    changesTreeCollapsedPaths: new Set(),
    changesScrollTop: 0,
    treeExpandedPaths: new Set(),
  }),
  history: () => ({
    refsClosedSections: new Set(),
    refsHeadExpandedFor: null,
    refsExpanded: new Map(),
    listScrollTop: 0,
    splitRatio: 0.4,
  }),
  review: () => ({ comments: new Map() }),
  files: () => ({ selectedFile: null, expandedPaths: new Set() }),
  prefs: () => ({ treeLineWrap: false }),
  nav: () => ({ lastTab: "terminal", gitCommit: undefined, gitMode: undefined, gitFile: undefined }),
};

/** What survives a reload, per kind. An allowlist rather than a denylist: a
 * field added to a shape is not persisted until someone decides it should be,
 * which is the safe direction for a store that can otherwise hold megabytes of
 * fetched diff lines. */
const PERSISTED: { [K in ViewSlotKind]: ReadonlyArray<keyof ViewStateShapes[K] & string> } = {
  diffAll: [
    "selectedFile",
    "collapsedFiles",
    "viewModeOverride",
    "scrollTop",
    "treeCollapsedPaths",
  ],
  diffFile: ["scrollTop"],
  file: ["lineWrap", "markdownPreview", "scrollTops"],
  commit: [
    "mode",
    "file",
    "commitExpandedPaths",
    "changesSelectedFile",
    "changesCollapsedFiles",
    "changesViewModeOverride",
    "changesTreeCollapsedPaths",
    "changesScrollTop",
    "treeExpandedPaths",
  ],
  history: [
    "refsClosedSections",
    "refsHeadExpandedFor",
    "refsExpanded",
    "listScrollTop",
    "splitRatio",
  ],
  review: ["comments"],
  files: ["selectedFile", "expandedPaths"],
  prefs: ["treeLineWrap"],
  // v1's nav shim reconstructs a route for a session that is already gone by
  // the time the page comes back. Nothing worth keeping.
  nav: [],
};

/** Slots a closing tab may take with it. The others outlive every tab in the
 * task: an unsubmitted review must not evaporate because the diff tab it was
 * written in was closed. */
const PRUNABLE: ReadonlySet<ViewSlotKind> = new Set<ViewSlotKind>([
  "diffAll",
  "diffFile",
  "file",
  "commit",
  "history",
]);

// ── addressing ──────────────────────────────────────────────────────────────

/** A view's address: the task it belongs to, and the key of the view within
 * that task (a `tabKey`, or one of the non-tab keys above). */
export interface ViewRef {
  taskId: string;
  key: string;
}

export function viewRef(taskId: string, key: string): ViewRef {
  return { taskId, key };
}

// NUL: a view key containing the separator cannot forge another task's address,
// and no key ever contains one.
const SEP = "\u0000";

function slotId(ref: ViewRef): string {
  return `${ref.taskId}${SEP}${ref.key}`;
}

function taskIdOf(slotKey: string): string {
  return slotKey.slice(0, slotKey.indexOf(SEP));
}

function viewKeyOf(slotKey: string): string {
  return slotKey.slice(slotKey.indexOf(SEP) + 1);
}

// ── change notification ─────────────────────────────────────────────────────
//
// Two panes can be bound to one slot at the same time — a split showing the
// all-files diff beside a single file of it addresses the task's one `review`,
// and `splitTab` will happily put the same tab in two groups. Each `useViewState`
// holds its own React copy, so without a signal the second write is computed
// against a copy taken before the first and silently drops it.
//
// Listeners are per *field*, not per slot: the per-frame writes (`scrollTop`,
// `listScrollTop`) then only ever wake a subscriber that reads that exact
// field, which in practice is nobody.

type ViewListener = () => void;

const listeners = new Map<string, Set<ViewListener>>();

function fieldId(ref: ViewRef, field: string): string {
  return `${slotId(ref)}${SEP}${field}`;
}

export function subscribeViewField(
  ref: ViewRef,
  field: string,
  listener: ViewListener,
): () => void {
  const id = fieldId(ref, field);
  let set = listeners.get(id);
  if (!set) {
    set = new Set();
    listeners.set(id, set);
  }
  set.add(listener);
  return () => {
    const current = listeners.get(id);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listeners.delete(id);
  };
}

function notifyViewField(ref: ViewRef, field: string): void {
  const set = listeners.get(fieldId(ref, field));
  if (!set || set.size === 0) return;
  // Copied: a listener may unsubscribe (a pane unmounting) mid-walk.
  for (const listener of [...set]) listener();
}

// ── the store ───────────────────────────────────────────────────────────────

interface Slot {
  kind: ViewSlotKind;
  state: unknown;
}

const store = new Map<string, Slot>();

/**
 * The live slot for `ref`, created from `kind`'s defaults on first touch.
 *
 * Returned by reference: reads are free, and a caller that mutates it in place
 * (a Map's `.set`, a scroll offset) must call `touchViewState` afterwards so
 * the change reaches storage.
 */
export function getViewState<K extends ViewSlotKind>(kind: K, ref: ViewRef): ViewStateShapes[K] {
  hydrate(ref.taskId);
  const id = slotId(ref);
  let slot = store.get(id);
  // A mismatched kind means the slot came from storage written by a version
  // that mapped this key to a different shape. Its contents cannot mean
  // anything to the caller asking now, and handing them over would return a
  // shape whose fields simply are not there — so start clean instead.
  if (!slot || slot.kind !== kind) {
    slot = { kind, state: DEFAULTS[kind]() };
    store.set(id, slot);
  }
  return slot.state as ViewStateShapes[K];
}

/** Write one field and schedule a save: the write path for everything that is
 * not an in-place mutation of a Set or Map. */
export function setViewField<K extends ViewSlotKind, F extends keyof ViewStateShapes[K]>(
  kind: K,
  ref: ViewRef,
  field: F,
  value: ViewStateShapes[K][F],
): void {
  getViewState(kind, ref)[field] = value;
  touchViewState(ref);
  notifyViewField(ref, field as string);
}

/** Announce that a slot was mutated in place, so the task's storage entry is
 * rewritten. Cheap: it only marks the task dirty. */
export function touchViewState(ref: ViewRef): void {
  scheduleSave(ref.taskId);
}

export function clearViewState(ref: ViewRef): void {
  // Or a slot that is only on disk survives the clear and is resurrected by
  // the next read.
  hydrate(ref.taskId);
  if (store.delete(slotId(ref))) scheduleSave(ref.taskId);
}

/**
 * Drop every slot of `taskId` whose key is not in `validKeys` — the tabs the
 * task's layout still holds. Non-tab slots (`review`, `files`, `prefs`, `nav`)
 * belong to the task rather than to any pane and are never pruned by a tab
 * closing.
 */
export function retainViewStates(taskId: string, validKeys: ReadonlySet<string>): void {
  // The caller that matters most — the layout, on load — runs before anything
  // has read this task, so without hydrating first there would be nothing in
  // memory to prune and a tab closed on another device would keep its state
  // forever. Cheap: a no-op once the task is loaded.
  hydrate(taskId);
  let changed = false;
  for (const [id, slot] of store) {
    if (taskIdOf(id) !== taskId) continue;
    if (!PRUNABLE.has(slot.kind) || validKeys.has(viewKeyOf(id))) continue;
    store.delete(id);
    changed = true;
  }
  if (changed) scheduleSave(taskId);
}

/** Forget a task entirely — archived, killed, or gone from the list. Mirrors
 * `retainLayouts` in layout-store. */
export function dropTaskViewStates(taskId: string): void {
  for (const id of [...store.keys()]) {
    if (taskIdOf(id) === taskId) store.delete(id);
  }
  const timer = pending.get(taskId);
  if (timer) {
    clearTimeout(timer);
    pending.delete(taskId);
  }
  hydrated.delete(taskId);
  removeStored(taskId);
}

/** Drop state for tasks no longer present, so entries for tasks that exit on
 * their own or are killed by another client don't leak. */
export function retainTaskViewStates(validTaskIds: ReadonlySet<string>): void {
  const seen = new Set<string>();
  for (const id of store.keys()) seen.add(taskIdOf(id));
  // Storage as well as memory. A task is not hydrated until one of its views is
  // opened, so on a fresh page load memory is empty and a sweep that only
  // consulted it would prune nothing at all — which is precisely the leak this
  // function exists to prevent, for tasks that died while the page was closed.
  for (const taskId of storedTaskIds()) seen.add(taskId);
  for (const taskId of seen) {
    if (!validTaskIds.has(taskId)) dropTaskViewStates(taskId);
  }
}

// ── persistence ─────────────────────────────────────────────────────────────

const STORAGE_PREFIX = "codetoaster:viewstate:";

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // A browser with site data blocked throws on the property itself.
    return null;
  }
}

const storageKey = (taskId: string) => `${STORAGE_PREFIX}${taskId}`;

/** Every task with an entry on disk, hydrated or not. Snapshotted rather than
 * iterated live, because the caller removes entries as it goes. */
function storedTaskIds(): string[] {
  const backing = storage();
  if (!backing) return [];
  const ids: string[] = [];
  try {
    for (let i = 0; i < backing.length; i++) {
      const key = backing.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) ids.push(key.slice(STORAGE_PREFIX.length));
    }
  } catch {
    // As elsewhere: storage that refuses to be read is storage we do without.
  }
  return ids;
}

/** JSON has no Set and no Map, and this store is mostly Sets and Maps. Tag
 * them on the way out and rebuild them on the way in; anything else passes
 * through untouched. */
function encode(value: unknown): unknown {
  if (value instanceof Set) return { __set: [...value].map(encode) };
  if (value instanceof Map) return { __map: [...value].map(([k, v]) => [k, encode(v)]) };
  if (Array.isArray(value)) return value.map(encode);
  return value;
}

function decode(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(decode);
  const tagged = value as { __set?: unknown[]; __map?: [string, unknown][] };
  if (Array.isArray(tagged.__set)) return new Set(tagged.__set.map(decode));
  if (Array.isArray(tagged.__map)) return new Map(tagged.__map.map(([k, v]) => [k, decode(v)]));
  return value;
}

const hydrated = new Set<string>();

/** Load a task's persisted slots on first touch. A malformed or half-written
 * entry costs the user their scroll offsets, which is not worth failing a
 * render over — the task simply starts at its defaults. */
function hydrate(taskId: string): void {
  if (hydrated.has(taskId)) return;
  hydrated.add(taskId);
  const backing = storage();
  if (!backing) return;
  try {
    const raw = backing.getItem(storageKey(taskId));
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, { kind?: string; state?: Record<string, unknown> }>;
    for (const [key, entry] of Object.entries(parsed)) {
      const kind = entry?.kind as ViewSlotKind | undefined;
      if (!kind || !(kind in DEFAULTS)) continue;
      // Written onto a fresh default, so a field added to the shape since the
      // entry was stored is present with its default rather than undefined.
      const state = DEFAULTS[kind]() as unknown as Record<string, unknown>;
      const stored = entry.state ?? {};
      for (const field of PERSISTED[kind] as ReadonlyArray<string>) {
        if (field in stored) state[field] = decode(stored[field]);
      }
      store.set(slotId({ taskId, key }), { kind, state });
    }
  } catch {
    // As above.
  }
}

function serialize(taskId: string): string | null {
  const out: Record<string, { kind: ViewSlotKind; state: Record<string, unknown> }> = {};
  for (const [id, slot] of store) {
    if (taskIdOf(id) !== taskId) continue;
    const fields = PERSISTED[slot.kind] as ReadonlyArray<string>;
    if (fields.length === 0) continue;
    const source = slot.state as Record<string, unknown>;
    const state: Record<string, unknown> = {};
    for (const field of fields) state[field] = encode(source[field]);
    out[viewKeyOf(id)] = { kind: slot.kind, state };
  }
  return Object.keys(out).length === 0 ? null : JSON.stringify(out);
}

function removeStored(taskId: string): void {
  const backing = storage();
  if (!backing) return;
  try {
    backing.removeItem(storageKey(taskId));
  } catch {
    // As below.
  }
}

function writeNow(taskId: string): void {
  const backing = storage();
  if (!backing) return;
  try {
    // Before serializing, not after: `serialize` reads only what is in memory,
    // so writing an un-hydrated task would serialize nothing and the empty
    // result would be taken for "this task has no state" and delete the entry.
    // A save can be scheduled before anything has read the task — that is the
    // whole reason this is here rather than left to the caller.
    hydrate(taskId);
    const payload = serialize(taskId);
    if (payload === null) backing.removeItem(storageKey(taskId));
    else backing.setItem(storageKey(taskId), payload);
  } catch {
    // A full or blocked quota costs the user their scroll offsets on the next
    // load, which is not worth failing a render over.
  }
}

// Writes are coalesced: a scroll handler calls `touchViewState` on every frame,
// and re-serializing a task's slots per frame is work nobody asked for.
const pending = new Map<string, ReturnType<typeof setTimeout>>();
const SAVE_DELAY_MS = 250;

function scheduleSave(taskId: string): void {
  if (!storage()) return;
  const existing = pending.get(taskId);
  if (existing) clearTimeout(existing);
  pending.set(
    taskId,
    setTimeout(() => {
      pending.delete(taskId);
      writeNow(taskId);
    }, SAVE_DELAY_MS),
  );
}

/** Write every pending save immediately. Also the seam tests use instead of
 * waiting out the debounce. */
export function flushViewStates(): void {
  for (const [taskId, timer] of pending) {
    clearTimeout(timer);
    writeNow(taskId);
  }
  pending.clear();
}

// A reload inside the debounce window would otherwise lose the last quarter
// second — which, since the last thing a user does before reloading is often
// scroll or type a comment, is the state they would most notice missing.
// Installed here rather than at the app's entry point so no consumer has to
// remember it. `pagehide` covers the back/forward cache, where `unload` never
// fires; `visibilitychange` covers a mobile tab backgrounded and then killed.
// `document`, not `addEventListener`: the latter exists on Bun's global too,
// and neither event has any meaning outside a browser.
if (typeof document !== "undefined") {
  addEventListener("pagehide", flushViewStates);
  addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushViewStates();
  });
}

/** Test seam: forget a task's state entirely, in memory and on disk, and drop
 * any save still in flight. */
export function resetViewStates(taskId: string): void {
  dropTaskViewStates(taskId);
}

// ── helpers ─────────────────────────────────────────────────────────────────

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

/** Copy of `set` with all `values` added; returns `set` unchanged (same
 * reference) when every value is already present, so setState callers can
 * bail out without re-rendering. */
export function withAll<T>(set: Set<T>, values: Iterable<T>): Set<T> {
  let next: Set<T> | null = null;
  for (const value of values) {
    if ((next ?? set).has(value)) continue;
    next ??= new Set(set);
    next.add(value);
  }
  return next ?? set;
}

/** Copy of `set` with all `values` removed; returns `set` unchanged (same
 * reference) when none are present. */
export function withoutAll<T>(set: Set<T>, values: Iterable<T>): Set<T> {
  let next: Set<T> | null = null;
  for (const value of values) {
    if (!(next ?? set).has(value)) continue;
    next ??= new Set(set);
    next.delete(value);
  }
  return next ?? set;
}

/** Returns `map` unchanged (same reference) when every entry passes `keep`,
 * so setState callers can bail out without re-rendering. */
export function pruneMap<V>(
  map: Map<string, V>,
  keep: (key: string, value: V) => boolean,
): Map<string, V> {
  let changed = false;
  const next = new Map<string, V>();
  for (const [key, value] of map) {
    if (keep(key, value)) {
      next.set(key, value);
    } else {
      changed = true;
    }
  }
  return changed ? next : map;
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
  return pruneMap(comments, (key, comment) => {
    const lineGone =
      validLineKeys !== undefined &&
      (comment.lineType === "addition" || comment.lineType === "deletion") &&
      !validLineKeys.has(key);
    return validPaths.has(comment.filePath) && !lineGone;
  });
}
