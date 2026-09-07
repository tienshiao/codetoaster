import { meaningfulTitle } from "@/lib/xtmux/naming";
import { DEFAULT_PROFILE } from "@/lib/agent/profile";
import type { TaskInfo } from "@/lib/xtmux/types";
import { INFERRED_STATE_NOTE, type TaskState } from "@/frontend/components/v2/StatusDot";
import type { TaskRowDetails } from "@/frontend/components/v2/TaskHoverCard";

/**
 * What a task row's hover card is told (TASK-97), as a function.
 *
 * Apart from the sidebar for the reason `task-list.ts` gives: none of this
 * needs a DOM, and every line of it is a decision about the *transport* that is
 * far easier to state as an input and an output than as a mounted component —
 * which of two branch fields is the one that is not a measurement, that the
 * path worth showing is the checkout when there is one, that an archived task
 * has no checkout left to describe.
 *
 * `TaskRowDetails` is plain data on the other side of it. The card knows
 * nothing about a `TaskInfo`, and this is the only place the two meet.
 */
export function detailsOf(
  task: TaskInfo,
  /** The row's *displayed* label — `sessionDisplayNames`' projection, not the
   * stored title. The card is a second look at the row, so it has to be a look
   * at the same name. */
  label: string,
  state: TaskState,
  projectNames: ReadonlyMap<string, string>,
): TaskRowDetails {
  const archived = task.lifecycle === "archived";
  return {
    title: label,
    preview: task.lastMessage ?? undefined,
    terminalTitle: meaningfulTitle(task.terminalTitle) || undefined,
    project: projectNames.get(task.projectId),
    state,
    // Not for an archived row, the same way its dot is not a guess: that state
    // is `exited` because the lifecycle says so, and nothing about it was
    // inferred from any output.
    stateNote: !archived && !task.hooks ? INFERRED_STATE_NOTE : undefined,
    // Nothing for an archived task: `archiveTask` removes the worktree
    // directory but keeps `worktree_path` on the row, so this would name a
    // directory that is not there any more.
    path: archived ? undefined : (task.worktreePath ?? task.cwd),
    // `undefined` only when the task has no checkout of its own — the same test
    // the row's branch glyph is drawn by, so an evicted or unmeasured checkout
    // still counts as one. The branch itself comes off the row and deliberately
    // not out of the measurement: an evicted task, or one whose first
    // measurement has not landed, has a branch in the database and
    // `worktree: null` on the wire (see `TaskInfo.branch`).
    branch: task.worktreeState === "none" ? undefined : (task.worktree?.branch ?? task.branch),
    dirty: task.worktree?.dirty ?? null,
    unpushed: task.worktree?.unpushed ?? 0,
    merged: task.worktree?.merged ?? false,
    // Only when someone chose it. Every task that named none reports the
    // default, and a line saying so on all thirty of them is noise.
    profile: task.profile === DEFAULT_PROFILE ? undefined : task.profile,
    createdAt: task.createdAt,
    lastActiveAt: task.lastActiveAt,
    viewers: task.clientCount,
    archived,
  };
}
