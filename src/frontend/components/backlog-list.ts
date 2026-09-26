// The Backlog section's list, as pure functions (TASK-85, TASK-118): which
// tasks land on which tab, under which header, in which order, and which of
// them a filter keeps. Apart from `BacklogSection.tsx` so `bun test` can hold
// every rule here without a DOM.

import type { BacklogTab } from "@/frontend/explorer-store";
import type { BacklogTask } from "@/types/backlog";

// ── sort ────────────────────────────────────────────────────────────────────

export const BACKLOG_SORTS = ["board", "updated", "created", "id"] as const;

export type BacklogSort = (typeof BACKLOG_SORTS)[number];

export const BACKLOG_SORT_LABELS: Record<BacklogSort, string> = {
  board: "Board order",
  updated: "Recently updated",
  created: "Recently created",
  id: "Newest ID",
};

export function isBacklogSort(value: unknown): value is BacklogSort {
  return (BACKLOG_SORTS as readonly unknown[]).includes(value);
}

/**
 * The sort a tab starts with. Closed is recency because board order there is
 * task-number order, oldest first, so the work just finished is at the very
 * bottom of a hundred-row list — TASK-116 and TASK-117 read as missing for
 * exactly that reason. Open keeps the board: its order is the one the user
 * (or the agent) arranged.
 */
export function defaultBacklogSort(tab: BacklogTab): BacklogSort {
  return tab === "Closed" ? "updated" : "board";
}

/** The stored choice for a tab, or its default. The store hands back whatever
 * was persisted, unchecked, so a value from a build with other sorts lands here
 * as the default rather than as a sort nothing recognises. */
export function resolveBacklogSort(tab: BacklogTab, stored: unknown): BacklogSort {
  return isBacklogSort(stored) ? stored : defaultBacklogSort(tab);
}

/**
 * A frontmatter date as a string that compares correctly, or null.
 *
 * Backlog.md writes `YYYY-MM-DD` or `YYYY-MM-DD HH:mm`, with no timezone, so
 * these are never turned into instants — padded and compared as text, which
 * is right for every value written in one local clock. A date-only value sorts
 * as midnight of its day. Anything else is treated as absent rather than
 * guessed at.
 */
export function dateKey(value: string | null): string | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(value.trim());
  if (!m) return null;
  const pad = (s: string | undefined) => (s ?? "0").padStart(2, "0");
  return `${m[1]}-${pad(m[2])}-${pad(m[3])} ${pad(m[4])}:${pad(m[5])}`;
}

/** The numeric parts of an id — `TASK-12.3` is `[12, 3]` — so TASK-100 comes
 * after TASK-99 and a subtask after its parent. An id with no number is `[]`. */
function idParts(id: string): number[] {
  const m = /(\d+(?:\.\d+)*)\s*$/.exec(id);
  return m ? m[1]!.split(".").map(Number) : [];
}

function compareIdParts(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? -1) - (b[i] ?? -1);
    if (d !== 0) return d;
  }
  return 0;
}

function touched(task: BacklogTask): string | null {
  return dateKey(task.updatedDate) ?? dateKey(task.createdDate);
}

/** Newest first; a task with no date after every task with one. */
function newestFirst(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? 1 : -1;
}

/**
 * The tasks in `sort` order, as a new array.
 *
 * The input is taken to be in board order, which is how the route hands it
 * over, and every tie falls back to it — `Array.prototype.sort` is stable — so
 * two tasks updated in the same minute never swap places between polls.
 *
 * "Recently updated" is the *last touched* time: a task that has never been
 * edited since it was filed has no `updated_date`, and its created date is
 * when it was last touched.
 */
export function sortBacklogTasks(tasks: readonly BacklogTask[], sort: BacklogSort): BacklogTask[] {
  const out = [...tasks];
  switch (sort) {
    case "board":
      return out;
    case "updated":
      return out.sort((a, b) => newestFirst(touched(a), touched(b)));
    case "created":
      return out.sort((a, b) => newestFirst(dateKey(a.createdDate), dateKey(b.createdDate)));
    case "id":
      return out.sort((a, b) => compareIdParts(idParts(b.id), idParts(a.id)));
  }
}

// ── filter ──────────────────────────────────────────────────────────────────

/**
 * Whether a task survives the filter. Case-insensitive, and every
 * whitespace-separated word has to appear somewhere in the id, title, labels or
 * description — not necessarily the same one — so "diff freeze" finds the task
 * titled "Oversized diffs freeze the page" and so does "117 frontend". An empty
 * or blank filter keeps everything.
 */
export function matchesBacklogFilter(task: BacklogTask, filter: string): boolean {
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [task.id, task.title, ...task.labels, task.description].join("\n").toLowerCase();
  return words.every((word) => haystack.includes(word));
}

// ── grouping ────────────────────────────────────────────────────────────────

export interface StatusGroup {
  status: string;
  header: boolean;
  tasks: BacklogTask[];
}

export interface Grouped {
  open: StatusGroup[];
  closed: StatusGroup[];
  openCount: number;
  closedCount: number;
}

export interface BacklogView {
  filter: string;
  openSort: BacklogSort;
  closedSort: BacklogSort;
}

const EMPTY: Grouped = { open: [], closed: [], openCount: 0, closedCount: 0 };

const UNFILTERED: BacklogView = { filter: "", openSort: "board", closedSort: "board" };

/**
 * The response's tasks, filtered, split at the terminal status and grouped for
 * display.
 *
 * The order of the Open *headers* never depends on the sort: the configured
 * statuses reversed with the terminal one dropped, which puts In Progress above
 * To Do for the default configuration and does the equivalent for a longer one
 * without naming a status. The sort orders the cards within each header, so
 * "recently updated" on Open is the most recently touched In Progress task
 * first, not a flat list that has lost what each task is waiting on.
 *
 * A status the configuration does not list still gets a header, at the end: a
 * hand-edited file with a typo'd status would otherwise take its task off both
 * tabs, and a task list that silently loses a row is worse than an odd header.
 *
 * The filter runs before the split, so both tab counts are the filtered ones
 * and a status the filter empties loses its header rather than heading nothing.
 */
export function groupBacklog(
  data: { statuses: string[]; tasks: BacklogTask[] } | null,
  view: BacklogView = UNFILTERED,
): Grouped {
  if (!data) return EMPTY;
  const terminal = data.statuses[data.statuses.length - 1];

  const byStatus = new Map<string, BacklogTask[]>();
  for (const task of data.tasks) {
    if (!matchesBacklogFilter(task, view.filter)) continue;
    const bucket = byStatus.get(task.status);
    if (bucket) bucket.push(task);
    else byStatus.set(task.status, [task]);
  }

  const openGroups: StatusGroup[] = [];
  const pushOpen = (status: string, tasks: BacklogTask[]) =>
    openGroups.push({ status, header: true, tasks: sortBacklogTasks(tasks, view.openSort) });
  for (const status of [...data.statuses].reverse()) {
    if (status === terminal) continue;
    const tasks = byStatus.get(status);
    if (tasks?.length) pushOpen(status, tasks);
  }
  for (const [status, tasks] of byStatus) {
    if (status === terminal || data.statuses.includes(status)) continue;
    pushOpen(status, tasks);
  }

  const closedTasks = terminal ? (byStatus.get(terminal) ?? []) : [];
  const closed: StatusGroup[] =
    closedTasks.length === 0
      ? []
      : [{ status: terminal!, header: false, tasks: sortBacklogTasks(closedTasks, view.closedSort) }];

  return {
    open: openGroups,
    closed,
    openCount: openGroups.reduce((n, g) => n + g.tasks.length, 0),
    closedCount: closedTasks.length,
  };
}
