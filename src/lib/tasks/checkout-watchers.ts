import * as fs from "fs";
import type { TaskRow } from "../db";
import type { TaskHost } from "./host";
import { startTaskWatcher, type WatcherHandle } from "./watcher";

/** The per-task checkout watchers. Split out of TaskManager (TASK-152). */
export class CheckoutWatchers {
  // One checkout watcher per live task while a client is connected (TASK-103).
  // The root is held alongside the handle because a task's checkout moves
  // under it — `refreshCwd` rewrites cwd and repo_root when the agent cd's,
  // `restoreTaskWorktree` rewrites worktree_path — and a watcher still pointed
  // at the old directory reports nothing about the new one while looking
  // perfectly healthy. Owned entirely by the reconcile below; nothing else
  // writes it.
  watchers: Map<string, { root: string; handle: WatcherHandle; failedAt?: number }> =
    new Map();
  /** How long a watch that died stays dead before a reconcile tries again.
   * Long enough that a persistent EMFILE does not restart a stream on every
   * title repaint, short enough that a dropped one is back within a session. */
  private static readonly WATCH_RETRY_MS = 30_000;

  constructor(private readonly host: TaskHost) {}

  /**
   * Bring the set of checkout watchers (TASK-103) into line with what should
   * be watched: every live task with a checkout on disk, while at least one
   * client is connected.
   *
   * Reconciled rather than started and stopped at each lifecycle site, because
   * the sites are many — resume, suspend, evict, archive, delete, boot
   * adoption — and one forgotten is a watcher leaked for the daemon's lifetime.
   * Every one of them ends in a `broadcastTask` or `broadcastTasks`, which is
   * where this hangs. Only the second of those reaches this method: the whole
   * walk is a `SELECT *` over the live rows and a `stat` each, and
   * `broadcastTask` fires per OSC title sequence, so it takes the single-row
   * path in `reconcileWatcher` instead.
   *
   * The client condition is not an optimisation. A `changed` message has
   * nobody to reach when no browser is attached, and a daemon left running
   * over a large checkout should not hold an FSEvents stream per task for the
   * hours between sessions to say so.
   */
  reconcileWatchers(): void {
    const live = this.host.store.list({ lifecycle: "live" });
    const liveIds = new Set(live.map((row) => row.id));
    // Rows that are no longer live — or no longer rows at all, which is what a
    // delete leaves — have nothing left to ask about, so they are stopped from
    // the outside before the survivors reconcile themselves.
    for (const taskId of [...this.watchers.keys()]) {
      if (!liveIds.has(taskId)) this.stopWatcher(taskId);
    }
    for (const row of live) this.reconcileWatcher(row);
  }

  /**
   * Where one task's watcher belongs, or null if it should have none.
   *
   * `repo_root` first, and that is the whole of the point: every route a batch
   * invalidates resolves through `resolveTaskRoot`, which hands back
   * `task.repo_root`, so the paths those routes speak are relative to the
   * repository's toplevel. A project pointed at `repo/frontend` — which
   * `initial_path` is explicitly allowed to be — has `cwd` there and
   * `repo_root` at `repo`: a watcher on the cwd would report `src/a.ts` where
   * the open file's query key holds `frontend/src/a.ts`, and would never see
   * an edit under `repo/backend` at all. The fallbacks are for a task with no
   * repository behind it, which has no route to disagree with.
   */
  private watchRootFor(row: TaskRow): string | null {
    if (this.host.clientCount() === 0) return null;
    if (row.lifecycle !== "live") return null;
    const root = row.repo_root ?? row.worktree_path ?? row.cwd;
    return fs.existsSync(root) ? root : null;
  }

  /**
   * One row's watcher, brought into line: the O(1) path, one point lookup and
   * one `stat`, which is what makes it safe to hang off `broadcastTask`.
   */
  reconcileWatcher(row: TaskRow): void {
    const wanted = this.watchRootFor(row);
    const entry = this.watchers.get(row.id);
    if (entry) {
      if (wanted === null) {
        this.stopWatcher(row.id);
        return;
      }
      const retryDue =
        entry.failedAt !== undefined &&
        Date.now() - entry.failedAt >= CheckoutWatchers.WATCH_RETRY_MS;
      // A watch on the right root that is still alive is left alone; the two
      // reasons to replace one are that the root moved and that the stream
      // died on it.
      if (entry.root === wanted && !retryDue) return;
      this.stopWatcher(row.id);
    }
    if (wanted === null) return;
    this.startWatcher(row.id, wanted);
  }

  private startWatcher(taskId: string, root: string): void {
    const handle = startTaskWatcher(
      root,
      (batch) => this.host.broadcastToAll({ type: "changed", taskId, ...batch }),
      {
        // A stream that died with its root still on disk — a transient EMFILE,
        // an FSEvents stream dropped — used to disable refresh for the task
        // until the daemon restarted, because the dead handle stayed in the map
        // and every later reconcile saw it and moved on. Marking it instead is
        // what makes the retry both possible and throttled: the next reconcile
        // past the window restarts it, and the ones before — many a second
        // under a busy agent's title repaints — neither restart nor log. A root
        // that went with the stream fails `existsSync` and is simply stopped.
        onError: (error) => {
          // Identity guard: a stopped handle never reports, but an entry
          // already replaced by a re-root must not be marked dead.
          const entry = this.watchers.get(taskId);
          if (entry?.handle === handle) entry.failedAt = Date.now();
          console.error(`Task ${taskId}: checkout watch ended:`, error.message);
        },
      },
    );
    this.watchers.set(taskId, { root, handle });
  }

  stopWatcher(taskId: string): void {
    const entry = this.watchers.get(taskId);
    if (!entry) return;
    this.watchers.delete(taskId);
    entry.handle.stop();
  }

  /** The tasks currently watched. For tests; the set is otherwise nobody's
   * business but `reconcileWatchers`'. */
  watchedTaskIds(): string[] {
    return [...this.watchers.keys()];
  }

  /** The root each watcher is on, for the tests that care that it moved. */
  watchedRoots(): Record<string, string> {
    return Object.fromEntries([...this.watchers].map(([taskId, entry]) => [taskId, entry.root]));
  }

  /** Shutdown: the process is about to exit and would take the streams with
   * it, but a watcher mid-settle would otherwise try to send on sockets that
   * are closing. */
  stopWatchers(): void {
    for (const taskId of [...this.watchers.keys()]) this.stopWatcher(taskId);
  }
}
