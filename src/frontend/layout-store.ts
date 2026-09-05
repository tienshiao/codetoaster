// The per-task tab layout (§7.2): what is open in a task's main area, which
// group each tab is in, and which one has focus.
//
// Everything here is a pure function over a `TaskLayout`. Nothing reads React
// state, nothing talks to the server, and every operation returns a new layout
// rather than mutating — so the whole tab model is testable without mounting
// anything, and the store that holds it can be swapped for a server-side one
// later without touching a single rule.
//
// Layout is a *per-device* concern: a phone should not inherit a desktop's
// three-way split. So it persists to localStorage keyed by task id, not to the
// task row.

import type { ShellCommand } from "@/frontend/keymap";

/** §7.2. The one thing a tab can be. `diffAll` is the whole-working-tree diff;
 * `diff` is one file of it. */
export type TabDescriptor =
  | { kind: "agent" }
  | { kind: "shell"; ptyId: string }
  | { kind: "diff"; path: string }
  | { kind: "diffAll" }
  | { kind: "file"; path: string; line?: number }
  | { kind: "commit"; sha: string }
  | { kind: "history" };

export type TabKind = TabDescriptor["kind"];

/** Terminal tabs are the ones bound to a live PTY. They can be dragged between
 * groups but never split, so a PTY is never rendered twice in one client. */
const TERMINAL_KINDS: ReadonlySet<TabKind> = new Set<TabKind>(["agent", "shell"]);

export function isTerminalTab(descriptor: TabDescriptor): boolean {
  return TERMINAL_KINDS.has(descriptor.kind);
}

/**
 * The dedupe identity of a descriptor: open something whose key is already
 * open and you focus that tab instead of getting a second one.
 *
 * `file`'s `line` is deliberately not part of the key. Going to a definition on
 * line 400 of a file already open on line 12 should move the cursor, not open
 * the file twice — which is the whole point of dedupe in a go-to-definition
 * flow. The caller applies the new line to the focused tab.
 */
export function tabKey(descriptor: TabDescriptor): string {
  switch (descriptor.kind) {
    case "agent":
      return "agent";
    case "diffAll":
      return "diffAll";
    case "history":
      return "history";
    case "shell":
      return `shell:${descriptor.ptyId}`;
    case "diff":
      return `diff:${descriptor.path}`;
    case "file":
      return `file:${descriptor.path}`;
    case "commit":
      return `commit:${descriptor.sha}`;
  }
}

/**
 * The descriptor a `tabKey` names, or null when it names nothing this build
 * knows how to open.
 *
 * The inverse of `tabKey`, and the reason `?tab=` can *ensure* a tab rather
 * than only focus one already open (§7.3). Split on the first colon only: a
 * `file:` or `diff:` key carries a path, and a path may contain colons.
 *
 * A `file` key round-trips without its `line`, which is `tabKey`'s existing
 * contract rather than a loss here — the line is a cursor position, not part of
 * what identifies the tab, and a link that wanted one would carry it itself.
 */
export function descriptorFromKey(key: string): TabDescriptor | null {
  const colon = key.indexOf(":");
  if (colon === -1) {
    switch (key) {
      case "agent":
        return { kind: "agent" };
      case "diffAll":
        return { kind: "diffAll" };
      case "history":
        return { kind: "history" };
      default:
        return null;
    }
  }

  const rest = key.slice(colon + 1);
  // An empty payload names no file, no PTY and no commit, so it is not a tab.
  if (!rest) return null;
  switch (key.slice(0, colon)) {
    case "shell":
      return { kind: "shell", ptyId: rest };
    case "diff":
      return { kind: "diff", path: rest };
    case "file":
      return { kind: "file", path: rest };
    case "commit":
      return { kind: "commit", sha: rest };
    default:
      return null;
  }
}

export interface TabState {
  /** Unique across the layout. Distinct from `key` because splitting a
   * read-only tab puts the same descriptor — and so the same key — in two
   * groups, while moves and closes still need to name exactly one tab. */
  id: string;
  descriptor: TabDescriptor;
  /** `tabKey(descriptor)`, carried so lookups do not recompute it. */
  key: string;
  /** VSCode's preview tab: opened by a single click, shown in italic, and
   * replaced by the next preview open in the same group. Pinning makes it
   * permanent. Without it, clicking through thirty commits leaves thirty tabs. */
  preview: boolean;
}

export interface TabGroup {
  id: string;
  tabs: TabState[];
  activeTabId: string;
  /** Share of the main area's width. A flat row of groups, not a recursive
   * grid: one-dimensional splits cover terminal-left/diff-right for a fraction
   * of the code, and nesting later is a change to this type alone. */
  flex: number;
}

export interface TaskLayout {
  groups: TabGroup[];
  activeGroupId: string;
}

// ── identity ────────────────────────────────────────────────────────────────

// Ids only have to be unique within one layout and are never persisted as
// anything but themselves, so a counter plus a random suffix is enough — and
// unlike crypto.randomUUID it works in a test runner with no DOM.
let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}${idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Test seam: makes ids deterministic within a test file. */
export function resetIdCounter(): void {
  idCounter = 0;
}

function makeTab(descriptor: TabDescriptor, preview = false): TabState {
  return { id: nextId("tab"), descriptor, key: tabKey(descriptor), preview };
}

function makeGroup(tabs: TabState[], activeTabId?: string, flex = 1): TabGroup {
  return {
    id: nextId("grp"),
    tabs,
    activeTabId: activeTabId ?? tabs[0]?.id ?? "",
    flex,
  };
}

/** A task's starting layout: one group holding the agent terminal. */
export function createLayout(): TaskLayout {
  const agent = makeTab({ kind: "agent" });
  const group = makeGroup([agent], agent.id);
  return { groups: [group], activeGroupId: group.id };
}

// ── lookup ──────────────────────────────────────────────────────────────────

export interface TabLocation {
  group: TabGroup;
  tab: TabState;
  groupIndex: number;
  tabIndex: number;
}

export function findTab(layout: TaskLayout, tabId: string): TabLocation | null {
  for (let groupIndex = 0; groupIndex < layout.groups.length; groupIndex++) {
    const group = layout.groups[groupIndex]!;
    const tabIndex = group.tabs.findIndex((t) => t.id === tabId);
    if (tabIndex !== -1) {
      return { group, tab: group.tabs[tabIndex]!, groupIndex, tabIndex };
    }
  }
  return null;
}

/** The tab a descriptor's key already occupies, preferring the active group —
 * a split can legitimately show the same file twice, and focusing the copy the
 * user is looking at is the least surprising of the two. */
export function findByKey(layout: TaskLayout, key: string): TabLocation | null {
  const activeIndex = layout.groups.findIndex((g) => g.id === layout.activeGroupId);
  const order = [activeIndex, ...layout.groups.map((_, i) => i)].filter(
    (i) => i >= 0 && i < layout.groups.length,
  );
  for (const groupIndex of order) {
    const group = layout.groups[groupIndex]!;
    const tabIndex = group.tabs.findIndex((t) => t.key === key);
    if (tabIndex !== -1) {
      return { group, tab: group.tabs[tabIndex]!, groupIndex, tabIndex };
    }
  }
  return null;
}

export function activeGroup(layout: TaskLayout): TabGroup {
  return layout.groups.find((g) => g.id === layout.activeGroupId) ?? layout.groups[0]!;
}

export function activeTab(layout: TaskLayout): TabState | null {
  const group = activeGroup(layout);
  return group.tabs.find((t) => t.id === group.activeTabId) ?? group.tabs[0] ?? null;
}

/** Every tab in the layout, in group order. */
export function allTabs(layout: TaskLayout): TabState[] {
  return layout.groups.flatMap((g) => g.tabs);
}

// ── operations ──────────────────────────────────────────────────────────────

function replaceGroup(layout: TaskLayout, groupId: string, next: TabGroup): TaskLayout {
  return { ...layout, groups: layout.groups.map((g) => (g.id === groupId ? next : g)) };
}

export interface OpenOptions {
  /** Opened by a single click: italic, and replaced by the next preview open
   * in the same group. Defaults to permanent. */
  preview?: boolean;
  /** Where to put it. Defaults to the active group. */
  groupId?: string;
}

/**
 * Open a descriptor, or focus it if its key is already open.
 *
 * Reopening as non-preview pins the tab that was already there — double-click
 * on an italic tab is the standard way to keep it, and it arrives here as a
 * second open of the same key.
 */
export function openTab(
  layout: TaskLayout,
  descriptor: TabDescriptor,
  options: OpenOptions = {},
): TaskLayout {
  const key = tabKey(descriptor);
  const existing = findByKey(layout, key);
  if (existing) {
    // The descriptor is refreshed even on a preview open, because that is how
    // a `line` reaches an already-open file. `preview` only ever clears here: a
    // tab the user pinned must not go back to italic because they clicked its
    // file in the tree again.
    const merged: TabState = {
      ...existing.tab,
      descriptor,
      preview: options.preview ? existing.tab.preview : false,
    };
    const group: TabGroup = {
      ...existing.group,
      tabs: existing.group.tabs.map((t) => (t.id === existing.tab.id ? merged : t)),
      activeTabId: existing.tab.id,
    };
    return { ...replaceGroup(layout, group.id, group), activeGroupId: group.id };
  }

  const target = options.groupId
    ? (layout.groups.find((g) => g.id === options.groupId) ?? activeGroup(layout))
    : activeGroup(layout);
  const tab = makeTab(descriptor, options.preview ?? false);

  // A preview open replaces the group's existing preview tab in place, so
  // arrowing through a commit list does not accumulate tabs.
  const previewIndex = tab.preview ? target.tabs.findIndex((t) => t.preview) : -1;
  const tabs =
    previewIndex === -1
      ? [...target.tabs, tab]
      : target.tabs.map((t, i) => (i === previewIndex ? tab : t));

  const group: TabGroup = { ...target, tabs, activeTabId: tab.id };
  return { ...replaceGroup(layout, group.id, group), activeGroupId: group.id };
}

/** Make a preview tab permanent. A no-op on a tab that already is. */
export function pinTab(layout: TaskLayout, tabId: string): TaskLayout {
  const found = findTab(layout, tabId);
  if (!found || !found.tab.preview) return layout;
  const group: TabGroup = {
    ...found.group,
    tabs: found.group.tabs.map((t) => (t.id === tabId ? { ...t, preview: false } : t)),
  };
  return replaceGroup(layout, group.id, group);
}

/**
 * Close a tab, unless it is the agent terminal.
 *
 * The agent tab is the task, so closing it would mean killing the task — which
 * is the task list's action, not the tab strip's. Refusing here rather than
 * only hiding the affordance means no caller can get it wrong.
 */
export function closeTab(layout: TaskLayout, tabId: string): TaskLayout {
  const found = findTab(layout, tabId);
  if (!found || found.tab.descriptor.kind === "agent") return layout;

  const tabs = found.group.tabs.filter((t) => t.id !== tabId);

  // The last group stays even when empty — the shell always has somewhere to
  // put the next tab, and a layout with no groups has no valid active ids.
  if (tabs.length === 0 && layout.groups.length > 1) {
    const groups = layout.groups.filter((g) => g.id !== found.group.id);
    const activeGroupId =
      layout.activeGroupId === found.group.id
        ? (groups[Math.min(found.groupIndex, groups.length - 1)]?.id ?? groups[0]!.id)
        : layout.activeGroupId;
    return { groups, activeGroupId };
  }

  // Focus falls to the neighbour on the right, then the left — the tab that
  // slid into the closed one's place.
  const nextActive =
    found.group.activeTabId === tabId
      ? (tabs[Math.min(found.tabIndex, tabs.length - 1)]?.id ?? "")
      : found.group.activeTabId;
  const group: TabGroup = { ...found.group, tabs, activeTabId: nextActive };
  return replaceGroup(layout, group.id, group);
}

/** Focus a tab, and the group holding it. */
export function focusTab(layout: TaskLayout, tabId: string): TaskLayout {
  const found = findTab(layout, tabId);
  if (!found) return layout;
  const group: TabGroup = { ...found.group, activeTabId: tabId };
  return { ...replaceGroup(layout, group.id, group), activeGroupId: group.id };
}

/** Whether Split is offered for a tab. Terminal tabs are never splittable: a
 * second view of a live PTY is a second stream to keep in sync, and when a user
 * wants another terminal they open one. */
export function canSplit(layout: TaskLayout, tabId: string): boolean {
  const found = findTab(layout, tabId);
  return found != null && !isTerminalTab(found.tab.descriptor);
}

/**
 * Show a tab in a new group beside its own. The original stays put — this is a
 * second view of the same content, which is why terminals are excluded.
 */
export function splitTab(layout: TaskLayout, tabId: string): TaskLayout {
  const found = findTab(layout, tabId);
  if (!found || !canSplit(layout, tabId)) return layout;

  const copy = makeTab(found.tab.descriptor, false);
  const group = makeGroup([copy], copy.id, found.group.flex);
  const groups = [...layout.groups];
  groups.splice(found.groupIndex + 1, 0, group);
  return { groups, activeGroupId: group.id };
}

/**
 * Move a tab to a group and position — the drag that makes terminal-left /
 * diff-right possible. Moving the last tab out of a group collapses it, unless
 * it is the only group left.
 */
export function moveTab(
  layout: TaskLayout,
  tabId: string,
  toGroupId: string,
  toIndex: number,
): TaskLayout {
  const found = findTab(layout, tabId);
  if (!found) return layout;
  const target = layout.groups.find((g) => g.id === toGroupId);
  if (!target) return layout;

  // A terminal must not end up in two groups, and a move never duplicates —
  // but the same key arriving in a group that already holds it would. Refuse
  // rather than silently drop one.
  if (target.id !== found.group.id && target.tabs.some((t) => t.key === found.tab.key)) {
    return layout;
  }

  if (target.id === found.group.id) {
    const rest = found.group.tabs.filter((t) => t.id !== tabId);
    const index = clamp(toIndex, 0, rest.length);
    const tabs = [...rest.slice(0, index), found.tab, ...rest.slice(index)];
    const group: TabGroup = { ...found.group, tabs, activeTabId: tabId };
    return { ...replaceGroup(layout, group.id, group), activeGroupId: group.id };
  }

  const sourceTabs = found.group.tabs.filter((t) => t.id !== tabId);
  const index = clamp(toIndex, 0, target.tabs.length);
  const destTabs = [...target.tabs.slice(0, index), found.tab, ...target.tabs.slice(index)];

  let groups = layout.groups.map((g) => {
    if (g.id === target.id) return { ...g, tabs: destTabs, activeTabId: tabId };
    if (g.id === found.group.id) {
      const activeTabId =
        g.activeTabId === tabId
          ? (sourceTabs[Math.min(found.tabIndex, sourceTabs.length - 1)]?.id ?? "")
          : g.activeTabId;
      return { ...g, tabs: sourceTabs, activeTabId };
    }
    return g;
  });
  if (sourceTabs.length === 0 && groups.length > 1) {
    groups = groups.filter((g) => g.id !== found.group.id);
  }
  return { groups, activeGroupId: target.id };
}

/** Set the width shares of the groups, left to right — the drag on a splitter.
 * Ignored unless it names every group, since a partial set cannot be balanced. */
export function setGroupFlex(layout: TaskLayout, flexes: number[]): TaskLayout {
  if (flexes.length !== layout.groups.length) return layout;
  if (flexes.some((f) => !Number.isFinite(f) || f <= 0)) return layout;
  return { ...layout, groups: layout.groups.map((g, i) => ({ ...g, flex: flexes[i]! })) };
}

// ── navigation ──────────────────────────────────────────────────────────────
//
// What the keyboard shortcuts move (TASK-34, keymap.ts). All reductions over
// the layout, so the dispatcher decides nothing: it looks up a command and
// applies it, and the rules about wrapping and clamping are testable without
// a keyboard.

/** Focus the tab `delta` along from the active one, within the active group.
 *
 * Wraps, because a group of two with no wrap makes the key dead half the time
 * — the state the user is in whenever they have the agent and one other thing
 * open, which is most of the time. Groups are not crossed: the strip the tab
 * order belongs to is the group's own, and moving between groups is its own
 * pair of commands. */
export function cycleTab(layout: TaskLayout, delta: number): TaskLayout {
  const group = activeGroup(layout);
  if (group.tabs.length < 2) return layout;
  const current = group.tabs.findIndex((t) => t.id === group.activeTabId);
  // An active id naming no tab is not reachable through the operations above,
  // but a revived layout is only checked for shape. Treat it as "before the
  // first", so the next tab is the first one rather than nothing.
  const from = current === -1 ? -delta : current;
  const length = group.tabs.length;
  const next = group.tabs[(((from + delta) % length) + length) % length]!;
  return focusTab(layout, next.id);
}

/** Focus the `index`-th tab of the active group, counting from 1.
 *
 * Out of range is left alone rather than clamped to the last tab: the chord
 * names a position, and a hand reaching for ⌘K 6 in a group of three means
 * that tab, not whichever one happens to be last. */
export function focusTabAt(layout: TaskLayout, index: number): TaskLayout {
  const tab = activeGroup(layout).tabs[index - 1];
  return tab ? focusTab(layout, tab.id) : layout;
}

/** Move focus to the neighbouring group, without moving anything into it.
 *
 * Clamped, not wrapped — the opposite of `cycleTab`, and for the same reason
 * it wraps. Groups are laid out in a row on screen, so "left" is a direction
 * on a surface the user is looking at; wrapping off the end would jump the
 * caret across the whole window. Tabs have no such geometry: a strip is a
 * cycle already. */
export function focusGroup(layout: TaskLayout, delta: number): TaskLayout {
  const index = layout.groups.findIndex((g) => g.id === layout.activeGroupId);
  const from = index === -1 ? 0 : index;
  const next = layout.groups[Math.min(Math.max(from + delta, 0), layout.groups.length - 1)];
  if (!next || next.id === layout.activeGroupId) return layout;
  return { ...layout, activeGroupId: next.id };
}

/** The task's agent tab, for the shortcut that goes back to it.
 *
 * Prefers the active group's copy, like `findByKey`, though only a hand-built
 * layout has two: `openTab` finds the existing agent tab rather than adding a
 * second, and `splitTab` refuses a terminal. */
export function findAgentTab(layout: TaskLayout): TabState | null {
  return findByKey(layout, tabKey({ kind: "agent" }))?.tab ?? null;
}

/**
 * Whether a leader command would do anything against this layout.
 *
 * One predicate for the two places that need it: the dispatcher, so a chord
 * that cannot act is a no-op rather than a side effect with no reduction
 * behind it, and the palette, so it lists no row that selecting would do
 * nothing. Written once because the two drifted apart in review — a guard
 * added to one side and not the other is a palette row that is dead, or a
 * chord the palette hides while the keyboard still fires it.
 *
 * `jump-tab` names a position the group may not have; `split` is refused for
 * a terminal; `close-tab` is refused for the agent tab, which is the task and
 * closes only through the task list. Everything else is always available:
 * `cycleTab` and `focusGroup` clamp or wrap on their own.
 */
export function commandAvailable(layout: TaskLayout, command: ShellCommand): boolean {
  switch (command.command) {
    case "jump-tab":
      return command.index != null && command.index <= activeGroup(layout).tabs.length;
    case "split": {
      const tab = activeTab(layout);
      return tab != null && canSplit(layout, tab.id);
    }
    case "close-tab": {
      const tab = activeTab(layout);
      return tab != null && tab.descriptor.kind !== "agent";
    }
    default:
      return true;
  }
}

/**
 * Drop shell tabs whose PTY is gone, and nothing else.
 *
 * Deliberately not done on load: a page reload leaves the task's shell PTYs
 * running server-side, and only a harvest or a daemon restart kills them. The
 * store has no way to know which — so the caller, which has just been told the
 * task's live PTYs, supplies the answer.
 */
export function pruneShellTabs(layout: TaskLayout, livePtyIds: ReadonlySet<string>): TaskLayout {
  const dead = allTabs(layout).filter(
    (t) => t.descriptor.kind === "shell" && !livePtyIds.has(t.descriptor.ptyId),
  );
  return dead.reduce((acc, tab) => closeTab(acc, tab.id), layout);
}

/**
 * Reconcile a restored layout against what the server says is running (§5.5).
 *
 * `pruneShellTabs` is the mechanism; this is the policy, and the policy is a
 * single rule: **drop a shell tab only on positive knowledge that its PTY is
 * gone, never on its absence from a list.** Two things count as knowledge.
 *
 * 1. The task is not `live`. A suspended task holds no processes at all — that
 *    is what suspension *is* — so every shell tab in the layout is stale. This
 *    is the reopen case §5.5 leaves to the UI to decide, and it is the one that
 *    has to survive a page reload across a harvest, where this client was never
 *    around to see the shells alive.
 * 2. The task is live and a PTY it *had* reported is no longer reported. The
 *    shell exited, or another client closed the tab.
 *
 * `seen` is what makes the second rule safe, and it is why this is not simply
 * "prune everything not in `shellPtyIds`". A shell tab is opened from the
 * response to `POST …/shell`, which races the task deltas coming down the
 * socket: a delta computed a moment before the spawn carries a `shellPtyIds`
 * without it. Pruning on absence would let that delta close the tab the user
 * just asked for. A PTY that has never been reported is therefore left alone —
 * we have been told nothing about it, and nothing is not evidence.
 *
 * The caller owns `seen` because it accumulates across renders; add this
 * update's ids to it before calling.
 */
export function reconcileShellTabs(
  layout: TaskLayout,
  task: { lifecycle: string; shellPtyIds: readonly string[] },
  seen: ReadonlySet<string>,
): TaskLayout {
  if (task.lifecycle !== "live") return pruneShellTabs(layout, new Set());
  const reported = new Set(task.shellPtyIds);
  const live = new Set(
    allTabs(layout)
      .flatMap((t) => (t.descriptor.kind === "shell" ? [t.descriptor.ptyId] : []))
      .filter((ptyId) => reported.has(ptyId) || !seen.has(ptyId)),
  );
  return pruneShellTabs(layout, live);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ── persistence ─────────────────────────────────────────────────────────────

const STORAGE_PREFIX = "codetoaster:layout:";

function storageKey(taskId: string): string {
  return `${STORAGE_PREFIX}${taskId}`;
}

/** localStorage throws rather than no-ops in a private window with site data
 * blocked, and is simply absent under a test runner — neither is a reason for
 * the shell to fail to render. */
function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isDescriptor(value: unknown): value is TabDescriptor {
  if (!value || typeof value !== "object") return false;
  const d = value as Record<string, unknown>;
  switch (d.kind) {
    case "agent":
    case "diffAll":
    case "history":
      return true;
    case "shell":
      return typeof d.ptyId === "string";
    case "diff":
      return typeof d.path === "string";
    case "file":
      return typeof d.path === "string" && (d.line === undefined || typeof d.line === "number");
    case "commit":
      return typeof d.sha === "string";
    default:
      return false;
  }
}

/**
 * Rebuild a layout from whatever was stored, or return null.
 *
 * Strict on purpose. A layout written by an older build is the normal case, not
 * an exceptional one, and the cost of guessing at a half-understood shape is a
 * shell that throws on mount — so anything that does not validate is discarded
 * in favour of a fresh layout. Ids are re-minted rather than trusted, which
 * also repairs a stored layout whose ids collided.
 */
export function reviveLayout(value: unknown): TaskLayout | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.groups) || raw.groups.length === 0) return null;

  const groups: TabGroup[] = [];
  let activeGroupId: string | null = null;

  for (const rawGroup of raw.groups) {
    if (!rawGroup || typeof rawGroup !== "object") return null;
    const g = rawGroup as Record<string, unknown>;
    if (!Array.isArray(g.tabs)) return null;

    const tabs: TabState[] = [];
    const keys = new Set<string>();
    let activeTabId: string | null = null;
    for (const rawTab of g.tabs) {
      if (!rawTab || typeof rawTab !== "object") return null;
      const t = rawTab as Record<string, unknown>;
      if (!isDescriptor(t.descriptor)) return null;
      const key = tabKey(t.descriptor);
      // A duplicate key inside one group was never reachable through the
      // operations above; a stored layout carrying one is corrupt.
      if (keys.has(key)) return null;
      keys.add(key);
      const tab = makeTab(t.descriptor, t.preview === true);
      if (typeof t.id === "string" && t.id === g.activeTabId) activeTabId = tab.id;
      tabs.push(tab);
    }

    const flex = typeof g.flex === "number" && Number.isFinite(g.flex) && g.flex > 0 ? g.flex : 1;
    const group = makeGroup(tabs, activeTabId ?? tabs[0]?.id, flex);
    if (typeof g.id === "string" && g.id === raw.activeGroupId) activeGroupId = group.id;
    groups.push(group);
  }

  // The agent tab is the one thing a layout cannot be missing, and a second one
  // would give the task two terminals claiming the same PTY.
  const agents = groups.flatMap((g) => g.tabs).filter((t) => t.descriptor.kind === "agent");
  if (agents.length !== 1) return null;

  // A terminal in two groups is the invariant `splitTab` exists to protect;
  // seeing one back from storage means the payload did not come from here.
  const terminalKeys = new Set<string>();
  for (const tab of groups.flatMap((g) => g.tabs)) {
    if (!isTerminalTab(tab.descriptor)) continue;
    if (terminalKeys.has(tab.key)) return null;
    terminalKeys.add(tab.key);
  }

  const nonEmpty = groups.filter((g) => g.tabs.length > 0);
  if (nonEmpty.length === 0) return null;
  const resolved = activeGroupId && nonEmpty.some((g) => g.id === activeGroupId)
    ? activeGroupId
    : nonEmpty[0]!.id;
  return { groups: nonEmpty, activeGroupId: resolved };
}

/** The task's stored layout, or a fresh one. Never throws. */
export function loadLayout(taskId: string): TaskLayout {
  const store = storage();
  if (!store) return createLayout();
  try {
    const raw = store.getItem(storageKey(taskId));
    if (!raw) return createLayout();
    return reviveLayout(JSON.parse(raw)) ?? createLayout();
  } catch {
    return createLayout();
  }
}

export function saveLayout(taskId: string, layout: TaskLayout): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(storageKey(taskId), JSON.stringify(layout));
  } catch {
    // A full or blocked quota costs the user their split on next load, which is
    // not worth failing a render over.
  }
}

export function clearLayout(taskId: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(storageKey(taskId));
  } catch {
    // As above.
  }
}

/** Forget layouts for tasks that no longer exist, so archiving a hundred tasks
 * does not leave a hundred dead entries behind. Mirrors `retainViewStates`. */
export function retainLayouts(validTaskIds: ReadonlySet<string>): void {
  const store = storage();
  if (!store) return;
  try {
    const stale: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (!key?.startsWith(STORAGE_PREFIX)) continue;
      if (!validTaskIds.has(key.slice(STORAGE_PREFIX.length))) stale.push(key);
    }
    for (const key of stale) store.removeItem(key);
  } catch {
    // As above.
  }
}
