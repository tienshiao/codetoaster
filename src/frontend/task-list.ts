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
 * Ordering is not here on purpose. `TaskInfo` arrives from the server already
 * sorted `last_active_at DESC` (§7.5's recency list), so every function below
 * preserves the order it is given rather than imposing one.
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
 * Groups come out in order of first appearance, which — given a recency-sorted
 * input — puts the project you touched last at the top. A task whose project
 * is gone still gets a group, headed by its raw id: dropping the row would be
 * worse than an ugly header.
 *
 * `alsoEmpty` is what keeps a project that has no tasks yet on screen — a
 * project the user just created has none by definition, and one that cannot be
 * seen cannot be deleted or filled either. They trail the groups that have
 * rows, because a group of nothing is not what the list is for.
 */
export function groupByProject<T extends ListableTask>(
  tasks: readonly T[],
  projectNames: ReadonlyMap<string, string>,
  alsoEmpty: readonly string[] = [],
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
  return [...groups.values()];
}
