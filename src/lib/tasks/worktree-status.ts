import { branchStatus } from "../worktree";
import type { TaskWorktreeInfo } from "../xtmux/types";
import type { TaskHost } from "./host";

/** Whether two measurements say the same thing. Field by field rather than by
 * serialising: this is asked once per Stop hook per task, and the point of it
 * is to avoid a broadcast, not to be clever. */
function sameWorktreeStatus(a: TaskWorktreeInfo, b: TaskWorktreeInfo): boolean {
  return a.branch === b.branch && a.dirty === b.dirty
    && a.unpushed === b.unpushed && a.merged === b.merged;
}

/** Each task's checkout status, for its card. Split out of TaskManager
 * (TASK-152). */
export class WorktreeStatusCache {
  /** What git last said about each task's checkout, for its card (§5.6, AC #5).
   *
   * A cache and not a column, because every one of these facts is about the
   * working tree and the ref store rather than about the task: a commit made in
   * a shell tab, a push from another terminal, a `git restore` — none of them
   * come past us, so a persisted copy would be a claim about the disk that
   * nothing re-checks and that survives a restart looking authoritative. In
   * memory it is at worst missing, which is the one state the wire can express
   * honestly. */
  worktreeStatus: Map<string, TaskWorktreeInfo> = new Map();
  /** When each entry above was measured, so a refresh can be skipped rather
   * than deduplicated after the fact. Separate from the map because an entry
   * being *absent* and being *stale* want different answers: absent is
   * measured-never and always worth doing. */
  private worktreeStatusAt: Map<string, number> = new Map();
  /** Tasks with a measurement in flight. `branchStatus` is five git processes
   * and the triggers overlap freely — a Stop hook can land while the restore
   * that provoked the last one is still running — so without this a busy agent
   * would have several identical sweeps of its own repository outstanding. */
  private measuring: Set<string> = new Set();

  /** How long a measurement stands before a backstop sweep will redo it.
   *
   * Long, because the events in manager.ts are the real freshness mechanism and this
   * only catches what happens outside them — a commit made in a shell tab, a
   * push from the user's own terminal. Short enough that a card is never wrong
   * for a whole sitting. */
  private worktreeStatusTtlMs = 5 * 60_000;

  constructor(private readonly host: TaskHost) {}

  /** Exposed for the tests, which are about *when* a measurement is retaken
   * rather than about any one duration. */
  setWorktreeStatusTtl(ms: number): void {
    this.worktreeStatusTtlMs = ms;
  }

  /** Re-measure a task's checkout, if it has one and the answer has gone stale.
   *
   * `branchStatus` already computes precisely what the card wants, and its
   * failure semantics are the ones a card needs: every question fails closed,
   * so a git that could not answer reads as "not established" rather than as
   * good news. The two fields the card does not use — `exists` and `pushed` —
   * are archive's, and asking for them costs nothing extra beyond what is
   * already being spawned.
   *
   * Only a `present` checkout is ever measured. An evicted one has no working
   * tree to count dirt in, and a task with no checkout of its own has no branch
   * of ours to report on — for both, `null` on the wire is the true answer and
   * not a missing one.
   *
   * Never throws: every caller is a side effect of something else — a hook
   * arriving, a restore finishing — and none of them is a worse operation for
   * failing to update a count. */
  async refreshWorktreeStatus(taskId: string, options: { force?: boolean } = {}): Promise<void> {
    const row = this.host.store.get(taskId);
    if (!row || row.worktree_state !== "present" || !row.branch || !row.worktree_path) {
      // Anything that used to have one and no longer does must lose its entry,
      // or an evicted task keeps showing the dirt count of a directory that is
      // not there any more.
      if (this.worktreeStatus.delete(taskId)) {
        this.worktreeStatusAt.delete(taskId);
        this.host.broadcastTask(taskId);
      }
      return;
    }
    if (this.measuring.has(taskId)) return;
    const measuredAt = this.worktreeStatusAt.get(taskId);
    if (!options.force && measuredAt !== undefined
        && Date.now() - measuredAt < this.worktreeStatusTtlMs) {
      return;
    }

    this.measuring.add(taskId);
    try {
      const repoRoot = await this.host.repoRootFor(row);
      if (!repoRoot) return;
      const status = await branchStatus(repoRoot, {
        branch: row.branch,
        baseRef: row.base_ref,
        worktreePath: row.worktree_path,
      });
      // Re-read rather than trusting `row`: five git processes is long enough
      // for the task to have been archived or deleted, and writing an entry for
      // a row that is gone leaves a card's worth of state nothing ever clears.
      if (!this.host.store.get(taskId)) return;
      const next: TaskWorktreeInfo = {
        branch: row.branch,
        dirty: status.dirty,
        unpushed: status.unpushed,
        // `atBase` is what keeps the 'archive?' nudge from firing on every
        // task the moment it is made: `merge-base --is-ancestor` is reflexive,
        // so a branch still standing on the commit it was cut from is
        // "merged" to git from the second `worktree add -b` returns. The card
        // is about work that has landed, and a branch nothing has happened on
        // has not landed anything. Archive still reads `status.merged` — a
        // branch with no commits of its own is precisely the one that is safe
        // to delete.
        merged: status.merged && !status.atBase,
      };
      const previous = this.worktreeStatus.get(taskId);
      this.worktreeStatus.set(taskId, next);
      this.worktreeStatusAt.set(taskId, Date.now());
      // Only when something moved. This runs on every Stop hook, and a task
      // whose agent is answering questions without touching the tree would
      // otherwise push an identical row to every client once a turn.
      if (!previous || !sameWorktreeStatus(previous, next)) this.host.broadcastTask(taskId);
    } catch (e) {
      console.warn(`Could not read the checkout status of task ${taskId}:`, e);
    } finally {
      this.measuring.delete(taskId);
    }
  }

  /** The backstop (§5.6): re-measure whatever the events in manager.ts have not.
   *
   * Called from the harvester's tick, which is the only thing already running
   * on a timer. It is not the mechanism — a checkout is measured when something
   * happened to it, and this only catches what happened outside the daemon —
   * so it does no work at all for a task measured inside its TTL.
   *
   * Sequential rather than `Promise.all`: this is five git processes per task
   * and there is nothing waiting on the answer, so a burst is all cost and no
   * benefit. */
  async refreshStaleWorktreeStatuses(): Promise<void> {
    const eligible = new Set<string>();
    for (const row of this.host.store.list({ lifecycle: ["live", "suspended"] })) {
      if (row.worktree_state !== "present") continue;
      eligible.add(row.id);
      await this.host.refreshWorktreeStatus(row.id);
    }
    // Everything that used to qualify and no longer does — archived, evicted,
    // hard-deleted. Purged here rather than at each of those call sites because
    // it is the same question in every one of them ("does this row still have a
    // checkout?"), and a site that forgot to ask would leave a card reporting
    // the dirt of a directory that is gone. `taskInfo` reads this map, so an
    // entry outliving its row is not merely stale, it is wrong.
    for (const taskId of [...this.worktreeStatus.keys()]) {
      if (eligible.has(taskId)) continue;
      this.worktreeStatus.delete(taskId);
      this.worktreeStatusAt.delete(taskId);
      if (this.host.store.get(taskId)) this.host.broadcastTask(taskId);
    }
  }
}
