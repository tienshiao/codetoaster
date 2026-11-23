import { profileCapabilities } from "../agent/profile";
import { worktreeCwd } from "../worktree";
import type { TaskInfo } from "../xtmux/types";
import type { TaskHost } from "./host";

export const DEFAULT_SIZE = { cols: 80, rows: 24 };

/** The TaskInfo projection: what the wire says about a task, assembled from
 * its row, its terminals and the manager's in-memory state. Split out of
 * TaskManager (TASK-152). */
export class TaskInfoProjection {
  constructor(private readonly host: TaskHost) {}

  /** Whether a task on this profile can report hooks at all, for the wire.
   * A name the registry does not answer to is `false`: there is no template to
   * read, and a task on one cannot be spawned, let alone reported for. */
  private profileHooks(name: string): boolean {
    const profile = this.host.profiles.get(name);
    return profile !== undefined && profileCapabilities(profile).hooks;
  }

  taskInfo(taskId: string): TaskInfo | undefined {
    const row = this.host.store.get(taskId);
    if (!row) return undefined;
    const pty = this.host.primaryPty(taskId);
    return {
      id: row.id,
      projectId: row.project_id,
      ptyId: pty?.id ?? null,
      shellPtyIds: this.host.shellPtys(taskId).map((shell) => shell.id),
      title: row.title,
      titleSource: row.title_source,
      terminalTitle: pty?.title ?? "",
      agentState: row.agent_state,
      profile: row.agent_profile,
      // Derived from the templates, not stored: `profileCapabilities` reads
      // whether anything in the profile names `{settings}`, which is the whole
      // of what "our hooks reach this agent" means. False for a profile the
      // registry no longer answers to — nothing can be spawned for it, so
      // nothing will report.
      hooks: this.profileHooks(row.agent_profile),
      restarted: this.host.isRestarted(taskId),
      lifecycle: row.lifecycle,
      worktreeState: row.worktree_state,
      // Null until measured, which a client must not read as "nothing to
      // report" — see `TaskWorktreeInfo`. The map is only ever written for a
      // task that has a checkout, so a task running in the project's own
      // directory answers null forever, correctly.
      worktree: this.host.worktreeStatusOf(taskId) ?? null,
      // The two columns are the state; there is no third thing to consult.
      // `worktree_state` alone would be true of an *evicted* task, whose ref is
      // the ordinary way it is stored rather than a decision anyone owes.
      //
      // Except mid-eviction, and mid-archive. `doEvict` and `doArchive` both
      // write the ref and broadcast before they remove the checkout, so for the
      // length of a `worktree remove` the row reads exactly like a refused
      // snapshot — and every attached client would draw a notice for a question
      // nobody is being asked, whose buttons `pendingWip` then refuses. Held
      // back rather than answered, so the two agree about what is outstanding.
      wipPending:
        row.worktree_state === "present"
        && row.wip_ref !== null
        && !this.host.isEvicting(row.id)
        && !this.host.isArchiving(row.id),
      cwd: row.cwd,
      worktreePath: row.worktree_path,
      // Composed rather than stored: it is the checkout and the offset, both of
      // which are already columns, and a third column agreeing with them is a
      // third column that can disagree.
      worktreeCwd: row.worktree_path
        ? worktreeCwd(row.worktree_path, row.worktree_subdir ?? "")
        : null,
      branch: row.branch,
      lastMessage: row.last_message,
      clientCount: pty?.getClientCount() ?? 0,
      // A suspended task remembers the grid it had, so resuming it does not
      // reflow the agent's output (§5.3).
      size: pty?.getSize() ?? {
        cols: row.last_size_cols ?? DEFAULT_SIZE.cols,
        rows: row.last_size_rows ?? DEFAULT_SIZE.rows,
      },
      createdAt: row.created_at,
      lastActiveAt: row.last_active_at,
      rankAt: row.rank_at,
      exited: pty?.exited ?? false,
      hasNotification: pty?.hasNotification ?? false,
    };
  }

  /**
   * Everything a user can still get back to, most recently active first: live
   * and suspended. A suspended task is not gone (§6) — it is one click from
   * being live again — so leaving it out would be the sidebar telling the user
   * their work had been deleted, which is the one thing suspension exists not
   * to do. Archived tasks stay out: those really have left (TASK-31).
   *
   * From the rows, not from `projects[].taskIds`. The in-memory grouping only
   * ever holds what it has been told to hold, so every path that makes a task
   * listable had to remember to call `ensureInProject` first — boot adoption
   * and the resume ladder both carry a comment explaining that they are doing
   * it for this reason, and a fourth such path would simply have been invisible
   * with nothing to say it was. The rows are the tasks; the grouping is one
   * view of them, and §7.5 demotes it to a toggle over a recency list anyway.
   *
   * That recency ordering is `store.list`'s own `rank_at DESC`, which is the
   * order the sidebar wants and the order project grouping never gave it.
   */
  listTasks(): TaskInfo[] {
    const result: TaskInfo[] = [];
    for (const row of this.host.store.list({ lifecycle: ["live", "suspended"] })) {
      const info = this.host.taskInfo(row.id);
      if (info) result.push(info);
    }
    return result;
  }

  /**
   * The rows `listTasks` leaves out, for the sidebar's archived toggle (§7.5).
   *
   * Its own call and not a flag on the snapshot, because archived rows only
   * ever accumulate: `broadcastTasks` re-sends the whole list on every create,
   * close and project change, and a year of finished tasks would ride each one
   * to every attached client. The toggle is what asks.
   *
   * Same `rank_at DESC` as the live list, so the archived rows are in
   * the order the sidebar would have put them in anyway.
   */
  listArchivedTasks(): TaskInfo[] {
    const result: TaskInfo[] = [];
    for (const row of this.host.store.list({ lifecycle: "archived" })) {
      const info = this.host.taskInfo(row.id);
      if (info) result.push(info);
    }
    return result;
  }

  /** The titles a new task's derived name has to be unique against. Suspended
   * ones count: two tasks in the same directory derive the same "<dir> ·
   * <branch>" label, and a user who cannot tell the new one from the one they
   * suspended an hour ago is no better off than if both were live. */
  taskTitles(): string[] {
    return this.host.listTasks().map((task) => task.title);
  }
}
