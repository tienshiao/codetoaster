import type { TaskInfo } from "@/lib/xtmux/types";

/**
 * What the task list is, as functions: which rows survive the filter and the
 * archived toggle, and how they fall into project groups.
 *
 * It lives apart from the sidebar for the same reason `layout-store.ts` lives
 * apart from `TabArea`: none of this needs a DOM, and the interesting cases —
 * a filter that has to match the *displayed* label, a task whose project was
 * deleted — are much easier to state as inputs and outputs than as a mounted
 * component.
 *
 * The ordering is still the server's. `TaskInfo` arrives from a `tasks`
 * snapshot already sorted `rank_at DESC` (§7.5's recency list, with the
 * hysteresis of TASK-116: `last_active_at` moves on every burst of output, so
 * sorting by it had busy tasks racing each other for the top), and
 * `selectTasks` preserves whatever order it is given rather than imposing one,
 * and so do the rows inside each of `groupByProject`'s groups. Neither of the
 * two places that sort invents an order: `byRecency` re-applies the server's
 * between snapshots, for the two frames that move one row's recency without
 * re-sending the list — a `task` delta and an `activity` stamp — and
 * `groupByProject` orders the groups themselves by the same `rank_at`, taken
 * per project (TASK-141).
 */

/** The fields the list logic reads. Narrow so a test can state a row in four
 * fields instead of building a whole `TaskInfo`. */
export type ListableTask = Pick<TaskInfo, "id" | "projectId" | "lifecycle" | "lastMessage">;

export interface TaskListOptions {
  /**
   * Displayed labels by task id — `sessionDisplayNames`' projection, not the
   * stored titles. The filter matches against these because they are what is
   * on screen: a task showing its terminal title reads "Fix the parser" while
   * its stored title is still "codetoaster · v2", and filtering on the stored
   * one hides the task the user just typed the name of.
   */
  labels: ReadonlyMap<string, string>;
  /** Project display names by id, for the filter and the group headers. */
  projectNames: ReadonlyMap<string, string>;
  filter?: string;
  /**
   * Archived tasks are hidden unless this is on.
   *
   * The rows are not in the task broadcast — archived ones only accumulate, and
   * that payload is re-sent on every create and close — so the sidebar fetches
   * them when the toggle goes on and concatenates them onto the live list. This
   * predicate stays the second guarantee: it is what makes an archived row
   * undrawable while the toggle is off, whatever the caller happened to hand in.
   */
  showArchived?: boolean;
}

export interface TaskGroup<T> {
  id: string;
  name: string;
  tasks: T[];
}

/**
 * The server's `rank_at DESC`, re-applied to a list one frame has disturbed.
 *
 * `rankAt`, never `lastActiveAt`: the age stamp moves on every rising edge of
 * output, several times a minute for a working agent, and a list sorted by it
 * reshuffles whenever two tasks are busy at once (TASK-116). The rank moves
 * only when a task wakes after a real quiet gap.
 *
 * Two properties matter more than the sort itself. It is *stable*, so rows
 * that tie — everything a fresh daemon has not touched yet shares a stamp, and
 * so does anything written inside the same millisecond — keep the order the
 * server gave them instead of shuffling on every delta. And it returns the
 * **same array instance** when nothing is out of order, so the common case
 * (a delta that changes a row's state and not its rank) allocates nothing and
 * re-renders nothing downstream: no row moves under a pointer that is mid-click
 * unless the rank genuinely changed.
 */
export function byRecency<T extends { rankAt: number }>(tasks: readonly T[]): T[] {
  for (let i = 1; i < tasks.length; i++) {
    if (tasks[i - 1]!.rankAt < tasks[i]!.rankAt) {
      // `Array.prototype.sort` is stable per spec, so equal stamps keep the
      // relative order of this copy — which is the order they arrived in.
      return [...tasks].sort((a, b) => b.rankAt - a.rankAt);
    }
  }
  return tasks as T[];
}

/** Case-folded once per query rather than once per row. */
function needleOf(filter: string | undefined): string {
  return (filter ?? "").trim().toLowerCase();
}

/**
 * Whether one row survives the filter. The three fields are what §7.5 asks
 * for: the label you can see, the project it belongs to, and the last thing
 * the agent said — which is often the only text on the row you remember.
 */
export function taskMatchesFilter(
  task: ListableTask,
  needle: string,
  label: string,
  projectName: string,
): boolean {
  if (!needle) return true;
  return (
    label.toLowerCase().includes(needle) ||
    projectName.toLowerCase().includes(needle) ||
    (task.lastMessage ?? "").toLowerCase().includes(needle)
  );
}

/** The rows the sidebar draws, in the order they arrived. */
export function selectTasks<T extends ListableTask>(
  tasks: readonly T[],
  { labels, projectNames, filter, showArchived = false }: TaskListOptions,
): T[] {
  const needle = needleOf(filter);
  return tasks.filter((task) => {
    if (task.lifecycle === "archived" && !showArchived) return false;
    const label = labels.get(task.id) ?? task.id;
    return taskMatchesFilter(task, needle, label, projectNames.get(task.projectId) ?? task.projectId);
  });
}

/**
 * The same rows, under project headers.
 *
 * Membership comes off `TaskInfo.projectId`, never `ProjectInfo.taskIds`: that
 * array is an in-memory ordering this run's creates appended to, so a task
 * suspended by a previous daemon is missing from it entirely. The project id
 * travels on the task for exactly this reason.
 *
 * Groups come out by rank, newest first: the newer of `projectRanks` (the
 * server's, archived tasks included) and the group's own rows' `rankAt`, so the
 * project you touched last is at the top and archiving a task does not move
 * its project. A task whose project is gone still gets a group, headed by its
 * raw id: dropping the row would be worse than an ugly header.
 *
 * `alsoEmpty` is what keeps a project with no rows on screen — a project the
 * user just created has none by definition, and one that cannot be seen cannot
 * be deleted or filled either. One whose tasks are all archived keeps its rank
 * and its place; one that has never had a task has no rank and trails the
 * groups that do, because a group of nothing is not what the list is for.
 */
export function groupByProject<T extends ListableTask & { rankAt?: number }>(
  tasks: readonly T[],
  projectNames: ReadonlyMap<string, string>,
  alsoEmpty: readonly string[] = [],
  projectRanks: ReadonlyMap<string, number | null | undefined> = new Map(),
): TaskGroup<T>[] {
  const groups = new Map<string, TaskGroup<T>>();
  const group = (id: string) => {
    let existing = groups.get(id);
    if (!existing) {
      existing = { id, name: projectNames.get(id) ?? id, tasks: [] };
      groups.set(id, existing);
    }
    return existing;
  };

  for (const task of tasks) group(task.projectId).tasks.push(task);
  for (const id of alsoEmpty) group(id);

  // A project's place is the newer of two ranks (TASK-141). The server's is
  // the highest rank among *all* its tasks, archived included, so archiving
  // the task that held the project up leaves the project where it was — and a
  // project whose every task is archived keeps its place rather than falling
  // to the empty ones at the bottom. Its visible tasks' own ranks are the
  // other, because the server's is only as fresh as the last snapshot: a task
  // waking after a quiet gap moves its rank by an `activity` frame, and its
  // project has to come up with it there and then.
  //
  // Stable, so groups that tie keep first-appearance order, which is what the
  // list did before. A group with no rank either way — a project that has
  // never had a task — trails, in the order it was handed.
  const rankOf = (g: TaskGroup<T>): number | null => {
    let rank = projectRanks.get(g.id) ?? null;
    for (const task of g.tasks) {
      if (typeof task.rankAt === "number" && (rank === null || task.rankAt > rank)) rank = task.rankAt;
    }
    return rank;
  };
  const ranked = [...groups.values()].map((g) => ({ g, rank: rankOf(g) }));
  ranked.sort((a, b) => {
    if (a.rank === null || b.rank === null) return a.rank === null ? (b.rank === null ? 0 : 1) : -1;
    return b.rank - a.rank;
  });
  return ranked.map(({ g }) => g);
}
