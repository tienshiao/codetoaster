import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { expandTilde } from "../tilde";
import {
  evictWorktree,
  isWithinWorktreesRoot,
  reconcileWorktrees,
  repoRootOf,
  type ReconcileReport,
  type UnclaimedWorktree,
} from "../worktree";
import type { TaskHost } from "./host";

/** What a daemon reconciles when it starts: the rows a restart left `live`,
 * and the checkouts on disk against the rows that claim them. Split out of
 * TaskManager (TASK-152). */
export class BootReconciler {
  /** The checkouts the boot sweep found and refused to delete (§5.6, TASK-32).
   *
   * In memory and not in the database, because they belong to no task and a row
   * is the one thing they are defined by not having. They are also only as true
   * as the last sweep — the user can delete one by hand at any moment — so
   * persisting them would mean carrying a claim about the disk across restarts
   * that nothing re-checks. A boot re-runs the sweep and re-derives this. */
  private unclaimedWorktrees: UnclaimedWorktree[] = [];

  constructor(private readonly host: TaskHost) {}

  /** Every `live` row is a lie at boot: closing the PTY masters took every
   * session shell and its children down with the daemon, so nothing survived
   * to be live (§5.5). Marking them suspended is the whole of what a restart
   * needs — the rows are still there to resume from.
   *
   * "There" now means in the list, which is why the adoption below is part of
   * the same pass. `loadProjects` starts every project's `taskIds` empty, since
   * the ordering is the only thing the rows do not record, and `listTasks`
   * walks that grouping rather than the rows — so without this a restart leaves
   * every task of the previous run present in the database, suspended, correct
   * in every column, and invisible. From the user's side that is
   * indistinguishable from the "restart nukes everything" this replaces.
   *
   * By last-active order, oldest first, so the sidebar reads the way it did
   * before the restart rather than in whatever order SQLite hands rows back. */
  reconcileOnBoot(): number {
    const stale = this.host.store.list({ lifecycle: "live" });
    for (const task of stale) {
      this.host.store.update(task.id, { lifecycle: "suspended", agent_state: "unknown" });
    }
    for (const task of this.host.store.list({ lifecycle: ["live", "suspended"] }).reverse()) {
      this.host.ensureInProject(task.id);
    }
    return stale.length;
  }

  /** The other half of the boot reconciliation (§5.6, Risk 5): the checkouts on
   * disk against the rows that claim them, in both directions.
   *
   * Separate from `reconcileOnBoot` and asynchronous, because the two are
   * different kinds of work with different urgency. That one is four SQLite
   * writes and the daemon cannot serve a correct task list until it has run;
   * this one shells out to git once per repository and can take as long as it
   * likes, so the boot path fires it and moves on.
   *
   * Direction (b) is here rather than in `reconcile.ts` because it is a row
   * update with no git in it: a task that says `present` while its directory is
   * gone is one somebody removed by hand between two runs, and `missing` is the
   * state that makes the next open rebuild it — `restoreTaskWorktree` already
   * treats anything but "present and on disk" as something to restore, and
   * already throws `branch-missing` when the branch went with the directory,
   * which the route turns into a card with buttons.
   *
   * Direction (a) is `reconcileWorktrees`, and what comes back from it is not
   * only a log: the checkouts it refused to delete are the unclaimed cards
   * (AC #2), held here because they belong to no task and so have nowhere else
   * to live.
   *
   * Never throws, like everything else on the boot path. */
  async reconcileWorktreesOnBoot(): Promise<ReconcileReport> {
    // Direction (b), first, so a row whose directory has gone is already
    // `missing` before the sweep decides what the directories mean.
    const rows = this.host.store.list({ lifecycle: ["live", "suspended"] });
    for (const row of rows) {
      if (row.worktree_state !== "present" || !row.worktree_path) continue;
      if (fs.existsSync(row.worktree_path)) continue;
      this.host.store.update(row.id, { worktree_state: "missing" });
      this.host.broadcastTask(row.id);
    }

    // What a checkout has to be named by to be spared. Archived rows are left
    // out on purpose: archive removes the checkout and keeps the branch and the
    // snapshot (TASK-31), so a directory still standing for one is a removal
    // that did not finish.
    const claimed = new Set(
      rows.filter((row) => row.worktree_path).map((row) => path.resolve(row.worktree_path!)),
    );

    // Every repository anything here knows about. Tasks first — a task carries
    // its own repository precisely so it can outlive the project (TASK-64) —
    // and the projects' own roots after, for a project whose tasks all went.
    const repoRoots = new Set<string>();
    for (const row of this.host.store.list()) {
      if (row.worktree_repo) repoRoots.add(row.worktree_repo);
    }
    for (const project of this.host.projects) {
      if (!project.initialPath) continue;
      const root = await repoRootOf(expandTilde(project.initialPath)).catch(() => null);
      if (root) repoRoots.add(root);
    }

    // A database with no tasks at all is not evidence that every checkout on
    // disk is an orphan — it is far likelier to be a daemon pointed at the
    // wrong `--db`, or a fresh one, and in both cases the rows that would have
    // claimed those directories exist somewhere else. Deleting on that reading
    // is the worst thing this method could do, and refusing costs only a sweep
    // that had, by its own account, nothing to reconcile against.
    //
    // Deleting a task already removes its checkout (TASK-31), so a genuinely
    // empty install with directories left under the root is a state something
    // else went wrong to produce, and handing it to the user is the right
    // answer there too.
    if (this.host.store.list().length === 0) return { removed: [], unclaimed: [] };

    // Every project id this database can name, which is what bounds the sweep
    // to our own checkouts. Two sources, because a task can outlive the project
    // that made it (TASK-64): the projects we hold, and the id embedded in each
    // task's own worktree path — `<root>/<projectId>/<taskId>`, so the parent
    // directory's name. Without the second, a task reassigned to General when
    // its project was deleted would have its live checkout read as a stranger's
    // and never reconciled.
    const projectIds = new Set(this.host.projects.map((p) => p.id));
    const taskIds = new Set<string>();
    for (const row of this.host.store.list()) {
      taskIds.add(row.id);
      if (row.worktree_path) projectIds.add(path.basename(path.dirname(row.worktree_path)));
    }

    // "Minted per database" is true of every project id but one. `general` is
    // inserted by the schema into *every* database that is opened, so two
    // daemons on two `--db` files both name it, and its bucket is the one place
    // the id above proves nothing — a second daemon's clean checkout under
    // `<root>/general/<id>` would read as our orphan and be deleted, which is
    // the failure the scoping exists to prevent. There the task id decides,
    // since that really is ours or not.
    let report: ReconcileReport;
    try {
      report = await reconcileWorktrees({
        repoRoots: [...repoRoots],
        claimed,
        projectIds,
        sharedProjectIds: new Set(["general"]),
        taskIds,
      });
    } catch (e) {
      console.warn("Could not reconcile worktrees:", e);
      return { removed: [], unclaimed: [] };
    }
    this.unclaimedWorktrees = report.unclaimed;
    if (report.unclaimed.length > 0) this.host.broadcastTasks();
    // After the sweep and not before it, so nothing is measured against a
    // `worktree_state` the pass above is about to correct. Awaited here because
    // the whole method is already fired-and-forgotten from the boot path — the
    // cards fill in as it goes.
    await this.host.refreshStaleWorktreeStatuses();
    return report;
  }

  /** The checkouts the sweep found and would not delete. Empty until the boot
   * sweep has run, which is the honest answer: "we have not looked yet" and
   * "there are none" are the same thing to a client, and the sweep is fired
   * rather than awaited. */
  getUnclaimedWorktrees(): UnclaimedWorktree[] {
    return this.unclaimedWorktrees;
  }

  /** Delete one of them, by the user's own decision.
   *
   * The path is re-checked against the worktrees root here and not only in
   * `reconcileWorktrees`, because this one arrives from a client: the list it
   * came from is ours, but the request is a string on the wire and nothing
   * about being answered earlier makes it safe now. Refusing a path that is not
   * in the current list is the actual guard — it is a closed set we produced —
   * and the root check backs it up.
   *
   * Answers false rather than throwing when the path is not one of ours, so a
   * stale client clicking a card the sweep has since forgotten gets a plain
   * "not there" instead of a 500. */
  async deleteUnclaimedWorktree(worktreePath: string): Promise<boolean> {
    const resolved = path.resolve(worktreePath);
    const found = this.unclaimedWorktrees.find((w) => w.path === resolved);
    if (!found) return false;
    if (!isWithinWorktreesRoot(resolved)) return false;
    if (found.repoRoot) {
      await evictWorktree(found.repoRoot, resolved);
    } else {
      // No repository to ask, so there is no registration to clean up either —
      // this is the directory git did not recognise. The user has looked at the
      // card and asked for it gone.
      await fsp.rm(resolved, { recursive: true, force: true });
    }
    this.unclaimedWorktrees = this.unclaimedWorktrees.filter((w) => w.path !== resolved);
    this.host.broadcastTasks();
    return true;
  }
}
