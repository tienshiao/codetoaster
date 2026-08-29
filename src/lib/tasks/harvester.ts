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

// The idle harvester (docs/v2-architecture.md §5.5). It decides *whether* a
// task should be harvested and nothing else — the harvesting itself is
// `TaskManager.suspendTask`, which `closeTask` reaches by another road
// entirely.
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
  // Whether a tick is still running. The last guard spawns a `ps` per terminal
  // and waits up to two seconds for each, so a daemon with enough live tasks
  // can take longer than one interval to walk them — and two ticks over the
  // same tasks would evaluate guards against a task the other one is in the
  // middle of killing.
  private ticking = false;

  constructor(private manager: TaskManager) {}

  /** How long a task has to have been idle before it is harvested. `0` — or
   * anything negative — turns the harvester off outright: the interval stays
   * armed, but a tick does nothing, so the setting can be changed back without
   * anything having to be restarted. */
  setHarvestAfter(ms: number): void {
    this.harvestAfterMs = ms;
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

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One pass over the live tasks. Never rejects, and never stops early: it is
   * driven by an interval that gets no second chance at the tasks a throw
   * skipped, and the task most likely to throw — one whose terminal is wedged
   * on a dead mount — is exactly the one whose neighbours still need looking
   * at. Exposed so tests can drive a sweep without waiting on the clock. */
  async tick(): Promise<void> {
    // Before anything is listed, not after: disabled means the harvester does
    // no work at all, not that it does the work and discards the answer.
    if (this.harvestAfterMs <= 0) return;
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = Date.now();
      let tasks: TaskRow[];
      try {
        tasks = this.manager.liveTasks();
      } catch (e) {
        console.warn("Idle harvester could not list tasks:", e);
        return;
      }
      for (const task of tasks) {
        try {
          if (await this.shouldHarvest(task.id, now)) await this.manager.suspendTask(task.id);
        } catch (e) {
          console.warn(`Idle harvester skipped task ${task.id}:`, e);
        }
      }
    } finally {
      this.ticking = false;
    }
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
    if (!this.rowAllows(taskId, now) || !this.hasNoAttachedViews(taskId)) return false;
    if (!(await this.nothingRunning(taskId))) return false;
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
