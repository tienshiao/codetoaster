import type { TaskRow } from "../db";
import type { TaskManager } from "./manager";

// How often the guards are evaluated. Not the resolution of `harvest_after` —
// a task becomes harvestable at a moment nothing is watching for, and this is
// only how long after that moment we notice. Cheap enough to run often: every
// guard but the last is a field on a row already in memory.
const TICK_MS = 30_000;

/** §5.5's idle timeout. Exported because the tests that are about *which* tasks
 * a running harvester takes set it explicitly rather than leaning on the
 * default being this. */
export const THIRTY_MINUTES_MS = 30 * 60_000;

// On by default now that a harvested task is reachable: the sidebar renders a
// suspended row as dormant rather than hiding it, and clicking one resumes it
// (TASK-16). That is what makes this a setting about processes rather than
// about the user's work — half an hour after they stopped typing they get
// their memory back, and a click gets their agent back. Zero still turns it
// off, for anyone who would rather pay for the processes.
const DEFAULT_HARVEST_AFTER_MS = THIRTY_MINUTES_MS;

/** §5.6's eviction grace, before it is scaled by what a restore costs. Long
 * because the thing being reclaimed is disk, which is cheap, while the thing
 * risked is a checkout somebody may still be thinking about. */
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60_000;
const DEFAULT_EVICT_AFTER_MS = SEVEN_DAYS_MS;

/** The setup duration one unit of grace is worth.
 *
 * Eviction is priced in restore *cost*, not in age or disk (§5.6): what the
 * user actually pays for an eviction is the wait when they come back, so a task
 * that rebuilds in 200ms is nearly free to evict and one that re-runs a
 * 90-second install is not. Thirty seconds is the scale on which a restore
 * stops feeling instant and starts being something you notice.
 *
 * Capped, because the multiplier is otherwise unbounded: one pathological
 * setup — a container build, a dependency graph fetched over a bad link —
 * would pin its task on disk effectively forever, which is the sprawl this
 * tier exists to stop. Four is far enough that a slow project is treated
 * visibly differently and near enough that it is still a month, not a year. */
const SETUP_SCALE_MS = 30_000;
const MAX_SETUP_SCALE = 4;

/** How long a suspended task keeps its checkout, given what its last restore
 * cost. Exported for the tests, which are about the shape of the curve rather
 * than about any one duration.
 *
 * A task with no recorded duration gets the base grace: nothing was measured,
 * either because the project has no setup command — in which case a restore
 * really is nearly free — or because setup never finished. Neither is a reason
 * to treat it as expensive. */
export function graceFor(baseMs: number, setupDurationMs: number | null): number {
  const scale = Math.min(1 + (setupDurationMs ?? 0) / SETUP_SCALE_MS, MAX_SETUP_SCALE);
  return baseMs * scale;
}

// The harvester (docs/v2-architecture.md §5.5, §5.6). It decides *whether* a
// task should be harvested and nothing else — the harvesting itself is
// `TaskManager.harvestTask` and `TaskManager.evictTask`, and `closeTask`
// reaches the same suspend by another road entirely, carrying none of the
// guards below. That `harvestTask` takes a predicate does not move the
// decision into the manager: the predicate is the pair re-checked in
// `shouldHarvest`, handed over so it can be asked once more from inside the
// snapshot write, which is the one window this file cannot see.
//
// Two tiers, sharing one timer because they share one shutdown: a sweep may be
// mid-write when the daemon is asked to stop, and `stop()` has to be able to
// hand back whatever is still running. They are otherwise independent — over
// different task lists, on different clocks, disabled separately — and the
// order is the only thing that couples them: idle harvesting runs first, so a
// task suspended by this very tick is one the evict tier can then consider. It
// will not take it, because its grace is measured in days and it has been
// suspended for microseconds, but the ordering is what makes that a fact about
// the policy rather than an accident of the loop.
//
// Every guard here is a reason not to act, and that asymmetry is the whole
// design (§9, risk 3). Failing to harvest an idle task costs a process sitting
// on some memory until the next tick, or until the user closes it themselves.
// Harvesting one that was not idle kills an agent mid-turn, or a build the user
// started in a shell tab and walked away from — so anything this cannot
// establish reads as a reason to leave the task alone.
export class Harvester {
  private timer?: Timer;
  private harvestAfterMs = DEFAULT_HARVEST_AFTER_MS;
  private evictAfterMs = DEFAULT_EVICT_AFTER_MS;
  // The tick still running, if there is one. The last guard spawns a `ps` per
  // terminal and waits up to two seconds for each, so a daemon with enough live
  // tasks can take longer than one interval to walk them — and two ticks over
  // the same tasks would evaluate guards against a task the other one is in the
  // middle of killing.
  //
  // Kept as the promise rather than as a flag because shutdown has to be able to
  // wait for it: a snapshot is a write to `scrollback.tmp` and a rename over the
  // real file, and a process that exits between the two leaves the staging file
  // behind for good — nothing but `removeSnapshot`, on a task being deleted,
  // ever clears one.
  private inFlight?: Promise<void>;

  constructor(private manager: TaskManager) {}

  /** How long a task has to have been idle before it is harvested. `0` — or
   * anything negative — turns the harvester off outright: the interval stays
   * armed, but a tick does nothing, so the setting can be changed back without
   * anything having to be restarted. */
  setHarvestAfter(ms: number): void {
    this.harvestAfterMs = ms;
  }

  /** The base grace before a suspended task's checkout is evicted, before the
   * scaling in `graceFor`. `0` — or anything negative — turns the tier off:
   * checkouts are kept forever and the disk is the user's problem, which is a
   * reasonable thing to want on a machine with plenty of it. */
  setEvictAfter(ms: number): void {
    this.evictAfterMs = ms;
  }

  start(): void {
    if (this.timer) return;
    const timer = setInterval(() => {
      // `tick` is documented never to reject, which is what makes this safe to
      // fire and forget: an interval callback has nobody to hand a rejection to.
      void this.tick();
    }, TICK_MS);
    // A background sweep is not a reason for the daemon to stay up.
    timer.unref?.();
    this.timer = timer;
  }

  /** Disarm the interval, and answer with the tick that is still running so a
   * caller on its way to `process.exit` can let it finish. Clearing the interval
   * only stops the *next* sweep; the one already walking the tasks goes on
   * awaiting a snapshot write, and killing it mid-write is what orphans a
   * staging file.
   *
   * Safe with nothing in flight, and safe to call twice: both answer a promise
   * that is already resolved. */
  stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    return this.inFlight ?? Promise.resolve();
  }

  /** One pass over the live tasks. Never rejects, and never stops early: it is
   * driven by an interval that gets no second chance at the tasks a throw
   * skipped, and the task most likely to throw — one whose terminal is wedged
   * on a dead mount — is exactly the one whose neighbours still need looking
   * at. Exposed so tests can drive a sweep without waiting on the clock. */
  async tick(): Promise<void> {
    // Both tiers off is the only thing that skips the sweep entirely. Testing
    // `harvestAfterMs` alone — which is what this did while there was one tier
    // — would let a user who turned off idle harvesting silently turn off
    // eviction with it, and the two settings answer completely different
    // questions: one is about processes on a machine with little memory, the
    // other about disk on a machine with little of that.
    if (this.harvestAfterMs <= 0 && this.evictAfterMs <= 0) return;
    if (this.inFlight) return;
    // Held, not just flagged, so `stop` has something to hand a shutdown.
    const sweep = this.sweep().finally(() => {
      this.inFlight = undefined;
    });
    this.inFlight = sweep;
    return sweep;
  }

  private async sweep(): Promise<void> {
    const now = Date.now();
    await this.sweepIdle(now);
    await this.sweepEvict(now);
    await this.sweepWorktreeStatus();
  }

  /** The backstop behind the card facts (§5.6, TASK-32).
   *
   * Not a harvest, and here only because this is the one thing already running
   * on a timer. A checkout is measured when something happens to it — a turn
   * finishing, a restore — and this catches the changes that happen outside the
   * daemon: a commit made in a shell tab, a push from the user's own terminal.
   * `refreshStaleWorktreeStatuses` does nothing at all for a task measured
   * inside its window, so an idle daemon spawns no git for this.
   *
   * Last, so a task this tick suspended or evicted is measured — or purged — in
   * the state the tick left it in rather than the one it started in.
   *
   * Guarded like the tiers above and for a different reason: they are switched
   * off by a user who does not want them, while this is skipped only because
   * `tick` returns early when both are off, and a sweep that ran anyway would
   * make "harvesting off" mean "except for the git". */
  private async sweepWorktreeStatus(): Promise<void> {
    try {
      await this.manager.refreshStaleWorktreeStatuses();
    } catch (e) {
      console.warn("Could not refresh checkout status:", e);
    }
  }

  /** §5.5: give back the processes of tasks nobody is using. */
  private async sweepIdle(now: number): Promise<void> {
    if (this.harvestAfterMs <= 0) return;
    let tasks: TaskRow[];
    try {
      tasks = this.manager.liveTasks();
    } catch (e) {
      console.warn("Idle harvester could not list tasks:", e);
      return;
    }
    for (const task of tasks) {
      try {
        if (!(await this.shouldHarvest(task.id, now))) continue;
        // The same two guards again, this time for the manager to ask on the
        // far side of the snapshot write — the window between judging this
        // task harvestable and its PTYs actually being killed, which is long
        // enough to service the attach of a user who has just clicked it.
        // Passed rather than reimplemented so the late guard cannot drift from
        // the early one — which is why it is `cheapGuards` handed over whole
        // rather than the same conjunction spelled out a third time here.
        await this.manager.harvestTask(task.id, () => this.cheapGuards(task.id, now));
      } catch (e) {
        console.warn(`Idle harvester skipped task ${task.id}:`, e);
      }
    }
  }

  /** §5.6: give back the disk of tasks that already have no processes.
   *
   * Far fewer guards than the tier above, and that is the design rather than an
   * omission. Everything `shouldHarvest` asks — is anything running, is anyone
   * watching, is the agent mid-turn — is a question about processes, and a
   * suspended task has none: they were all discharged on the way in. What is
   * left is the two questions eviction actually has, which are whether the user
   * asked us to keep this one and whether enough time has passed.
   *
   * `evictTask` re-reads the row and refuses anything not suspended, so the
   * window between listing and acting is closed there rather than here. */
  private async sweepEvict(now: number): Promise<void> {
    if (this.evictAfterMs <= 0) return;
    let tasks: TaskRow[];
    try {
      tasks = this.manager.suspendedTasks();
    } catch (e) {
      console.warn("Evict tier could not list tasks:", e);
      return;
    }
    for (const task of tasks) {
      try {
        if (this.shouldEvict(task, now)) await this.manager.evictTask(task.id);
      } catch (e) {
        console.warn(`Evict tier skipped task ${task.id}:`, e);
      }
    }
  }

  /** Whether a suspended task has been resting long enough to be worth the
   * disk it is holding.
   *
   * Off `last_active_at` rather than `idle_since`: the latter is the agent's
   * clock — when it stopped working — and what grace asks is how long since the
   * *user* cared. A task the user was reading five minutes ago, whose agent has
   * been idle for a week, is not one to evict out from under them.
   *
   * The row is enough here, unlike the tier above: nothing asked costs a
   * process, and `evictTask` re-reads before it acts. */
  private shouldEvict(task: TaskRow, now: number): boolean {
    if (task.pinned !== 0) return false;
    if (task.worktree_state !== "present") return false;
    return now - task.last_active_at > graceFor(this.evictAfterMs, task.setup_duration_ms);
  }

  /** Every guard in §5.5, cheapest first: three fields off the row, then the
   * attached views, then the one that costs a process per terminal.
   *
   * By id, and re-read from the store rather than taken from the listing: a
   * sweep spawns a `ps` per terminal and waits up to two seconds for each, so
   * minutes can pass between `liveTasks()` and the moment a given task is
   * judged. The listed row is a photograph of the start of the tick, and every
   * decision here is about now — a task whose agent went `busy` in that window
   * (a prompt submitted from another client, with the tab then closed) would
   * otherwise be harvested mid-turn on the strength of an `agent_state` that
   * has not been true for a while. The agent is its own PTY's foreground
   * process, so `nothingRunning` does not catch it either.
   *
   * The row guards are asked twice for the same reason: the second ask is on
   * the far side of the only await here, which is where the window actually
   * is. */
  private async shouldHarvest(taskId: string, now: number): Promise<boolean> {
    if (!this.cheapGuards(taskId, now)) return false;
    if (!(await this.nothingRunning(taskId))) return false;
    return this.cheapGuards(taskId, now);
  }

  /** The guards worth asking more than once: the row, and who is watching.
   * Named because they are asked three times over one harvest — either side of
   * the `ps` above, and once more from inside `doSuspend` — and a guard written
   * out at each of those points is a guard free to drift from the others. */
  private cheapGuards(taskId: string, now: number): boolean {
    return this.rowAllows(taskId, now) && this.hasNoAttachedViews(taskId);
  }

  /** The three row guards, against the row as it stands right now. */
  private rowAllows(taskId: string, now: number): boolean {
    const task = this.manager.getTask(taskId);
    // Gone entirely: closed while the tick was walking towards it.
    if (!task) return false;
    return isLive(task) && isIdle(task) && this.idleLongEnough(task, now);
  }

  /** How long the task has been idle, against the configured timeout. A null
   * `idle_since` is not "idle since forever": it is a task nobody ever saw
   * stop working — an agent that reports no hooks, or one whose `Stop` we
   * missed — and harvesting on the strength of a column that was never written
   * would suspend it while it was still going. */
  private idleLongEnough(task: TaskRow, now: number): boolean {
    return task.idle_since !== null && now - task.idle_since > this.harvestAfterMs;
  }

  /** Whether anybody is watching. Summed over every terminal the task holds and
   * every client attached to each, since a second browser on one PTY is a
   * second view (§3) and the one open tab in it is reason enough to leave the
   * task alone. */
  private hasNoAttachedViews(taskId: string): boolean {
    let views = 0;
    for (const pty of this.manager.taskPtyList(taskId)) views += pty.getClientCount();
    return views === 0;
  }

  /** Whether every one of the task's terminals is sitting at its own prompt.
   * The agent being idle says nothing about a shell tab left running a build,
   * a test watcher, or an editor with unsaved work — and killing the PTY takes
   * all of it down. `hasForegroundProcess` answers `true` when it could not
   * tell, so an unanswerable terminal blocks the harvest rather than being
   * assumed empty. */
  private async nothingRunning(taskId: string): Promise<boolean> {
    for (const pty of this.manager.taskPtyList(taskId)) {
      if (await pty.hasForegroundProcess()) return false;
    }
    return true;
  }
}

/** The row still says live. Cheap, but not redundant: a tick can take seconds
 * to reach a given task, and the resume, close or manual suspend that moved it
 * in the meantime is the more recent decision. */
function isLive(task: TaskRow): boolean {
  return task.lifecycle === "live";
}

/** The agent said it stopped. Only `idle` passes — `busy` is mid-turn,
 * `needs_attention` is a question waiting for the user, `compacting` is a turn
 * that has not finished, and `starting`, `unknown` and `could_not_resume` are
 * all forms of not knowing. */
function isIdle(task: TaskRow): boolean {
  return task.agent_state === "idle";
}
