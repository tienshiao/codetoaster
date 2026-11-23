import type { TaskRow } from "../db";
import { isUserInput } from "../xtmux/user-input";
import type { TaskHost } from "./host";
import type { TaskUpdate } from "./store";

/** The window of the rank rule (TASK-116). The agent's output moves a task to
 * the top of the list only when the agent's terminal has produced none for
 * this long; typing into any of the task's terminals moves it; and either way
 * a rank never moves twice inside it. A shell's output never moves it at all.
 * Well past the PTY's 300ms idle threshold, which an agent pausing to think
 * crosses several times a minute, and short enough that coming back to a task
 * after a coffee still reads as "this just happened". */
export const RERANK_QUIET_MS = 60_000;

/** Recency, rank and degraded-mode inference: when each PTY last produced
 * output, each task's rank, and the clock on a task's first hook. Split out
 * of TaskManager (TASK-152). */
export class TaskActivity {
  /** When each PTY last changed activity state — the last moment it started
   * or stopped producing output — keyed by PTY id. The agent's entry is what
   * the rank rule measures quiet from (TASK-116), and is seeded when the agent
   * is spawned (`adopt`), so its first burst is measured from then. A shell's
   * entry, seeded the same way in `adoptShell`, only times its own age
   * broadcast: measured per task, a dev server logging every thirty seconds
   * in a shell tab kept the agent from ever counting as quiet. Never set by input: typing is not output. Not
   * the row's `last_active_at`: hooks stamp that too, and a hook is not
   * output. In memory because it is about the processes; an entry goes when
   * its PTY is unmapped. */
  private outputEdgeAt: Map<string, number> = new Map();
  /** Each task's `rank_at`, as last written — `stampRank`, the column's one
   * writer, sets both — or read from the row on a miss. It is what both wake
   * rules check the rank's freshness against, so the rest of a keystroke
   * burst, or the echo of the keystroke that woke the task, is turned away
   * without a row read. Cleared when the task is deleted; a suspended task's
   * entry is still true. */
  rankAt: Map<string, number> = new Map();
  // The timers waiting to find out whether a task's agent reports a hook
  // (§9, risk 4). The other half of `hookSeen` (hooks.ts), whose comment
  // says why both are in memory.
  private hookGraceTimers: Map<string, Timer> = new Map();
  private hookGraceMs = 10_000;

  constructor(private readonly host: TaskHost) {}

  /** How long a new task has to report its first hook before it is called
   * `unknown`. Long enough that a slow start is not mistaken for a hookless
   * one; short enough that a task never sits on `starting` for good. */
  setHookGrace(ms: number): void {
    this.hookGraceMs = ms;
  }

  /**
   * Write an activity edge's stamps, and say whether it moved the task's rank.
   *
   * Quiet means no output from the agent, and it is measured from the agent
   * PTY's previous edge (`outputEdgeAt`), on either side. From the falling
   * edge because measured from the last rising one, an agent that streamed
   * output for ten minutes and stopped would count as quiet the moment it
   * stopped. And not
   * from `last_active_at`, because hooks write that too: Claude Code's
   * `idle_prompt` Notification fires about a minute into a silent prompt,
   * and a gap it could reset would close just as it reached the threshold, so
   * the task the user comes back to would never rise. Only when the previous
   * edge is `RERANK_QUIET_MS` behind does `rank_at` move — and only when
   * `rank_at` itself is that old, so a rank moves at most once per window:
   * the echo of a keystroke that just woke the task does not wake it again a
   * few milliseconds later. A task working continuously therefore never
   * moves, tasks working side by side keep their order, and one that wakes
   * after a real pause still comes to the top (TASK-116).
   *
   * Per PTY, so a shell tab has no say in it. Measured per task, a dev server
   * logging every thirty seconds kept the agent from ever counting as quiet;
   * and a shell's output no longer ranks, so there is nothing left for its
   * edges, or its being mid-burst, to guard against — only a wake for them to
   * veto.
   *
   * The agent's edges may rerank (`rank`); a shell's never do (see
   * `adoptShell`), and are recorded for the shell's own `longGap`. Input is
   * the other way a task wakes, in `wakeOnInput`, by a rule of its own.
   *
   * `last_active_at` is still written on both edges: it is the age column and
   * the harvester's grace, and both want the last moment anything happened.
   *
   * Off SQL where it can be, since this runs on every edge of every PTY: the
   * edge and the rank are both in memory (`rankAt`), so a falling edge, or a
   * rising one that does not rerank, is one write.
   *
   * Returns the new `rank_at` when the rank moved, and whether this PTY's
   * previous edge was missing or at least `RERANK_QUIET_MS` back (`longGap`)
   * — which is when the age column visibly jumps, and what `adoptShell`
   * broadcasts on.
   */
  stampActivity(
    taskId: string,
    ptyId: string,
    active: boolean,
    now: number,
    rank: boolean,
  ): { rankAt?: number; longGap: boolean } {
    const lastEdge = this.outputEdgeAt.get(ptyId);
    const longGap = lastEdge === undefined || now - lastEdge >= RERANK_QUIET_MS;
    const rerank = active && rank && this.isQuiet(taskId, lastEdge, now);
    this.outputEdgeAt.set(ptyId, now);
    // The write's own read-back is what confirms the row is still there, so
    // a rank is never cached or reported for a task that is gone.
    const row = rerank ? this.stampRank(taskId, now) : this.host.store.update(taskId, { last_active_at: now });
    if (!row) return { longGap: false };
    return rerank ? { rankAt: now, longGap } : { longGap };
  }

  /** The one writer of `rank_at` (TASK-116): the column and `rankAt` together,
   * with `last_active_at` at the same moment — every rank move is also the
   * task being active — and whatever else the caller's write carries
   * (`extra`, e.g. the resume's `lifecycle`), so it stays one statement.
   * `extra` may say otherwise about `last_active_at` (only the test seam
   * does), never about `rank_at`. Nothing is cached for a row that is gone.
   * Returns the updated row. */
  stampRank(taskId: string, at: number, extra: TaskUpdate = {}): TaskRow | undefined {
    const row = this.host.store.update(taskId, { last_active_at: at, ...extra, rank_at: at });
    if (row) this.rankAt.set(taskId, at);
    return row;
  }

  /** Whether the agent's rising edge at `now` may move the task's rank: its
   * previous edge `RERANK_QUIET_MS` back, and the rank at least that old too,
   * so that it never moves twice inside one window.
   *
   * An agent PTY with no edge on record is not quiet. It always has one,
   * seeded by `adopt`; the row's `last_active_at` is not a stand-in, because
   * hooks stamp it without output, and re-admitting them is the bug this rule
   * exists to remove. */
  private isQuiet(taskId: string, lastEdge: number | undefined, now: number): boolean {
    if (lastEdge === undefined || now - lastEdge < RERANK_QUIET_MS) return false;
    const rankAt = this.rankOf(taskId);
    return rankAt !== undefined && now - rankAt >= RERANK_QUIET_MS;
  }

  /** The task's `rank_at`, from `rankAt` or, on a miss, the row — which is
   * then remembered. Undefined when there is no row. */
  private rankOf(taskId: string): number | undefined {
    const cached = this.rankAt.get(taskId);
    if (cached !== undefined) return cached;
    const row = this.host.store.get(taskId);
    if (!row) return undefined;
    this.rankAt.set(taskId, row.rank_at);
    return row.rank_at;
  }

  /**
   * Input is the user being here, so typing into any of a task's terminals
   * wakes it (TASK-116) — and is the only thing that wakes it from a shell
   * tab, whose output never reranks.
   *
   * Only input a person produced: xterm.js writes focus reports, colour-query
   * answers and mouse reports through the same message, and a blur — clicking
   * away to another task — would otherwise wake the task being left
   * (`isUserInput`). Keys that send sequences — Escape, Shift+Tab, the arrows
   * — are a person, and count.
   *
   * Measured from the rank alone, not from output. Output is the wrong clock
   * here: a shell tab logging every twenty seconds keeps its terminal busy for
   * as long as it runs, and gated on that the user typing into the task could
   * never move it — the one unambiguous "user is here" signal, suppressed in
   * exactly the case it is for. What holds it back is a rank already fresh —
   * the task woke, or was started, less than `RERANK_QUIET_MS` ago — so a rank
   * still moves at most once per window.
   *
   * The rank comes from `rankAt`, so the rest of a keystroke burst returns
   * before any SQL. Nothing is remembered about a keystroke turned away, so it
   * cannot hold back the next one once the rank has aged out. Input never
   * touches `outputEdgeAt` — typing is not output — so the echo that follows
   * is an ordinary output edge, and `isQuiet`'s rank freshness check is what
   * stops it waking the task a second time.
   *
   * A `task` delta rather than an `activity` frame, for `adoptShell`'s reason:
   * the frame's `active` is the agent's dot, and input says nothing about it.
   */
  wakeOnInput(ptyId: string, data: string): void {
    if (!isUserInput(data)) return;
    const taskId = this.host.taskIdForPty(ptyId);
    if (taskId === undefined) return;
    const now = Date.now();
    const rankAt = this.rankOf(taskId);
    if (rankAt === undefined || now - rankAt < RERANK_QUIET_MS) return;
    if (this.stampRank(taskId, now)) this.host.broadcastTask(taskId);
  }

  /** Back-date a PTY's last output edge. For tests: the rank rule waits on
   * `RERANK_QUIET_MS` of real silence, which nothing else can age. */
  setOutputEdgeAt(ptyId: string, at: number): void {
    this.outputEdgeAt.set(ptyId, at);
  }

  /** Back-date a task's rank. Exists for tests, for the same reason as
   * `setOutputEdgeAt`; through `stampRank`, because a rank written to the row
   * alone would be shadowed by the one the manager remembers. Unlike a real
   * rank move it leaves `last_active_at` as it was, so a test can age the two
   * apart. */
  setRankAt(taskId: string, at: number): void {
    const row = this.host.store.get(taskId);
    if (row) this.stampRank(taskId, at, { last_active_at: row.last_active_at });
  }

  /** The PTY's last output edge, if one is on record. For tests. */
  outputEdgeOf(ptyId: string): number | undefined {
    return this.outputEdgeAt.get(ptyId);
  }

  /** Record a PTY's first output edge, when it is adopted. */
  seedOutputEdge(ptyId: string, at: number): void {
    this.outputEdgeAt.set(ptyId, at);
  }

  /** Drop a PTY's output edge, when it is unmapped. */
  forgetOutputEdge(ptyId: string): void {
    this.outputEdgeAt.delete(ptyId);
  }

  /** The heuristic's answer, for a task that has no better one. Confined to
   * the states the heuristic is entitled to speak about: a task that has
   * exited, or that is waiting on the user, is not idle just because its
   * terminal went quiet. */
  inferState(taskId: string, active: boolean): void {
    const current = this.host.store.get(taskId)?.agent_state;
    if (current !== "starting" && current !== "unknown" && current !== "busy" && current !== "idle") {
      return;
    }
    const next = active ? "busy" : "idle";
    if (current === next) return;
    // `idle_since` is stamped here too, and not only by the hook path: it is
    // what the idle harvester counts from (TASK-15), and nothing else writes
    // it for a task running in degraded mode. Left alone, an agent that
    // reports no hooks inherits whatever the column held from its previous
    // life — a `Stop` from hours ago, or the value a restart left behind — so
    // the first time output activity infers `idle` the task is already past
    // `harvest_after` and is suspended out from under a user who has only just
    // reopened it. Same restamp, and the same reason, as the `/clear` and
    // resume case in `transitionFor`.
    this.host.store.update(taskId, {
      agent_state: next,
      ...(next === "idle" ? { idle_since: Date.now() } : {}),
    });
    this.host.broadcastTask(taskId);
  }

  /** Start the clock on a task's first hook. If none arrives, the task stops
   * claiming to be `starting` and admits it does not know. */
  armHookGrace(taskId: string): void {
    this.disarmHookGrace(taskId);
    const timer = setTimeout(() => {
      this.hookGraceTimers.delete(taskId);
      if (this.host.hasSeenHook(taskId)) return;
      // Only from `starting`. If output activity has already said busy or
      // idle, that is a better answer than `unknown` and replacing it would
      // be a downgrade.
      if (this.host.store.get(taskId)?.agent_state !== "starting") return;
      this.host.store.update(taskId, { agent_state: "unknown" });
      this.host.broadcastTask(taskId);
    }, this.hookGraceMs);
    // Nothing should be held open waiting to relabel a task.
    timer.unref?.();
    this.hookGraceTimers.set(taskId, timer);
  }

  disarmHookGrace(taskId: string): void {
    const timer = this.hookGraceTimers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.hookGraceTimers.delete(taskId);
    }
  }
}
