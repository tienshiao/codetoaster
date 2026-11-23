import { profileCapabilities } from "../agent/profile";
import { DEFAULT_PROFILE } from "../agent/profiles";
import { writeTaskSettings } from "../agent/settings";
import { buildAgentCommand, taskEnv, type AgentMode } from "../agent/spawn";
import {
  canResumeSessionId,
  continueIsSafe,
  findResumableTranscript,
  runsInOwnWorktree,
  sessionIdFromTranscript,
} from "../agent/transcripts";
import type { TaskRow } from "../db";
import { readSetupOutcome, setupStampPath, wrapWithSetup } from "../worktree";
import type { Pty } from "../xtmux/pty";
import type { TaskHost } from "./host";
import type { InFlight } from "./inflight";
import { DEFAULT_SIZE } from "./task-info";

/** Bringing a task's agent back (§4.3): the spawn every agent of an existing
 * row goes through, the resume ladder that decides what to spawn, and what is
 * held about the process that answered — whether it is a restart, and when it
 * was spawned, for dating the setup stamp. Split out of TaskManager
 * (TASK-152). */
export class TaskResumption {
  /** Which tasks are running a *restart* rather than a resume (TASK-89.4).
   *
   * A restart is what a profile that can neither `--resume` nor `--continue`
   * gets when its task is reopened: the same command, in the same directory,
   * with no conversation behind it. The card has to be able to say so, because
   * from the outside a restarted task and a resumed one look identical — a live
   * terminal on a task that was suspended — and the difference is everything
   * the user was in the middle of.
   *
   * In memory for the same reason `hookSeen` (hooks.ts) is: it describes the process
   * running *now*, not the task. A daemon that restarted suspended every task
   * it had, so there is no process left for this to be true of. */
  private restarted: Set<string> = new Set();
  /** When each task's agent was last spawned, for turning the setup wrapper's
   * stamp into a duration. Not `created_at`: a restore (TASK-39) runs setup
   * again years after the row was written, and dating the reinstall from the
   * task's birth would say the checkout took a fortnight to build. In memory
   * because it is only read once, by the first hook of the process it dates —
   * a daemon that restarted in between killed that process anyway. */
  private spawnedAt: Map<string, number> = new Map();
  private startTimeoutMs = 4_000;

  constructor(
    private readonly host: TaskHost,
    private readonly inflight: InFlight,
  ) {}

  /** How long a resume waits to see whether the agent came up before deciding
   * it did (§4.3). Only the cap — a hook or an exit settles it sooner. */
  setStartTimeout(ms: number): void {
    this.startTimeoutMs = ms;
  }

  /** How long the checkout took to become usable, off the setup wrapper's
   * stamp (§5.6, `lib/worktree/setup.ts`).
   *
   * Read exactly once, when the task's first hook arrives, and that timing is
   * the whole design: the wrapper only `exec`s the agent after setup exits
   * zero, so a hook — which only an agent that loaded our settings can send —
   * is proof the stamp is already on disk. Nothing polls, and nothing waits.
   *
   * Fire-and-forget from `applyHook`, which is synchronous and answers a live
   * HTTP request. Nothing downstream needs this to have landed: the only
   * consumer is the eviction grace scale, days later.
   *
   * A task with no setup command records nothing, which is correct — there was
   * no cost to remember. So does one whose setup aborted before the stamp was
   * written, and so does a non-zero exit: the agent never started, so what was
   * measured is the cost of failing, not the cost of a restore. */
  async recordSetupOutcome(taskId: string): Promise<void> {
    const spawnedAt = this.spawnedAt.get(taskId);
    // Spent on the first read, which is also what keeps a *resumed* task from
    // overwriting a real duration with a meaningless one. `spawnAgent` clears
    // `hookSeen`, so every resume presents a fresh edge to `applyHook` and
    // arrives back here — and the stamp still on disk belongs to the create,
    // not to this spawn. Only the run that wrote a stamp gets to date it, and
    // when a restore re-runs setup (TASK-39) it will record its own moment.
    this.spawnedAt.delete(taskId);
    if (spawnedAt === undefined) return;
    const outcome = await readSetupOutcome(setupStampPath(taskId), spawnedAt);
    if (!outcome || outcome.exitCode !== 0) return;
    // Checked again on the far side of the await: a task deleted while this
    // was reading would otherwise be resurrected as a row holding one column.
    if (!this.host.store.get(taskId)) return;
    this.host.store.update(taskId, { setup_duration_ms: outcome.durationMs });
    this.host.broadcastTask(taskId);
  }

  /** Date the task's agent as spawned at `at`. The create path's write. */
  setSpawnedAt(taskId: string, at: number): void {
    this.spawnedAt.set(taskId, at);
  }

  /** Forget when the task's agent was spawned, for a task whose stamp nothing
   * will read: archived, or deleted. */
  clearSpawnedAt(taskId: string): void {
    this.spawnedAt.delete(taskId);
  }

  /** Forget that the task's process was a restart, for the sites outside the
   * ladder that put a process down or start a fresh one. */
  clearRestarted(taskId: string): void {
    this.restarted.delete(taskId);
  }

  isRestarted(taskId: string): boolean {
    return this.restarted.has(taskId);
  }

  /** Spawn an agent for a task that already has a row, wire it up, and start
   * its hook clock. Shared by the create path and every rung of the resume
   * ladder, so a resumed agent gets the same settings file, the same scrubbed
   * environment and the same task-id plumbing as a fresh one. */
  private async spawnAgent(
    row: TaskRow,
    options: {
      mode: AgentMode;
      sessionId?: string;
      cols?: number;
      rows?: number;
      /** The project's setup command, when this spawn is following a restore
       * (§5.6). Null every other time, and that distinction is the point: a
       * resume that changed no directory is running in a checkout that was
       * already set up, and re-running `bun install` over it on every reopen
       * would make suspending a task expensive.
       *
       * Wrapped around the agent rather than awaited before it, exactly as
       * `createTask` does, so a cold `bun install` is visible output in the
       * agent tab instead of a blank pane for forty seconds. */
      setupCommand?: string | null;
    },
  ): Promise<Pty> {
    // The question both users of this flag ask is "has the agent that is
    // running now reported?", not "has anything ever reported for this task".
    // A task resumed inside a daemon that already saw its hooks would
    // otherwise start out as if the new process had already checked in:
    // awaitAgentStart would return true before the process had drawn a
    // character, and the very first rung of the ladder would be declared a
    // success however dead it was.
    //
    // Cleared on the far side of the settings write, not before it. `codetoaster
    // hook` is a separate process that `Bun.spawn().kill()` does not signal, so
    // a hook POSTed by the rung the ladder just discarded can land during that
    // await — and a flag set then would make `awaitAgentStart` return true
    // instantly for the *next* rung, declaring it a success however dead it is.
    //
    // The profile off the row, not off the project: what a resume has to render
    // is the templates the conversation was opened with (TASK-89). Its
    // `{settings}` is also what decides whether there is a file to write at all
    // — a profile that cannot be pointed at one gets no directory — but the two
    // sets are cleared either way, since what they are about is the process
    // that is starting now.
    //
    // `require` and not `get`, even though a `profiles.json` edit can take a
    // profile out from under a live row: `resumeLadder` answers such a row with
    // an empty ladder, so the loop that calls this never runs a rung and this
    // is unreachable for it. Throwing is also the right shape if it ever does
    // become reachable — the ladder reads a throw from here as "the binary is
    // unrunnable, no rung will do better" and stops, which is exactly true of a
    // profile that does not exist.
    const profile = this.host.profiles.require(row.agent_profile);
    const capabilities = profileCapabilities(profile);
    const settingsPath = capabilities.hooks ? await writeTaskSettings(row.id) : undefined;
    this.host.forgetAgentProcess(row.id);
    const pty = this.host.spawnPty(
      wrapWithSetup(
        buildAgentCommand(row, {
          mode: options.mode,
          sessionId: options.sessionId,
          settingsPath,
          profile,
          cwd: row.cwd,
        }),
        options.setupCommand,
        setupStampPath(row.id),
      ),
      {
        cols: options.cols,
        rows: options.rows,
        cwd: row.cwd,
        env: taskEnv(process.env, { taskId: row.id, port: this.host.port, origin: this.host.origin }),
      },
    );
    this.host.adopt(pty, row.id);
    // Only for a profile that can actually send one — see `createTask`, where
    // the same gate is applied for the same reason.
    if (capabilities.hooks) this.host.armHookGrace(row.id);
    return pty;
  }

  /** Whether the agent actually came up.
   *
   * Decided by the hook, not by a timer: any hook at all means the process got
   * far enough to load our settings and run one, which is a far sharper signal
   * than "it has not exited yet". A PTY that exits first is the failure — a
   * `--resume` on an id with no conversation prints one line and exits 1
   * (verified). The cap resolves as success on purpose: an agent running with
   * hooks disabled reports nothing however well it is doing, and killing a
   * working terminal because it was quiet would be the worse mistake.
   *
   * A hookless profile (TASK-89.4) therefore always settles on the cap, and
   * output activity is deliberately *not* offered as a second observation for
   * it. Output is not evidence of a working agent: the failure this exists to
   * catch is a rung that prints one line of error and exits, so treating the
   * first byte as success would declare exactly the doomed rung healthy and
   * stop the ladder on it. Quiet-but-still-up remains the only honest reading
   * we have for an agent that cannot speak for itself. */
  private awaitAgentStart(taskId: string, pty: Pty): Promise<boolean> {
    const capMs = this.startTimeoutMs;
    if (this.host.hasSeenHook(taskId)) return Promise.resolve(true);
    return new Promise((resolve) => {
      const finish = (started: boolean) => {
        clearInterval(poll);
        clearTimeout(cap);
        resolve(started);
      };
      const poll = setInterval(() => {
        if (this.host.hasSeenHook(taskId)) finish(true);
        else if (pty.exited) finish(false);
      }, 25);
      // `!pty.exited`, not a bare `true`: the cap means "quiet, but still up",
      // and a process that has already died is neither. The poll would catch it
      // 25ms later anyway — this only stops the timer winning that race and
      // declaring a corpse a working agent.
      const cap = setTimeout(() => finish(!pty.exited), capMs);
    });
  }

  /** Take back a PTY that did not work out, so the next rung starts clean. */
  private discardPty(pty: Pty, taskId: string): void {
    // Unmapped before the kill, like everywhere else: nothing here wants the
    // kill-time edge's stamps, and `onExit`'s guard already expects the
    // unmapping.
    this.host.unmapAndKill(taskId, [pty.id]);
    // Only if it was the one: this is reached with the agent's terminal, and
    // clearing the slot unconditionally would be right today and wrong the
    // moment anything discards a shell through here.
    if (this.host.agentPtyId(taskId) === pty.id) this.host.forgetAgentPty(taskId);
    this.host.forgetAgentProcess(taskId);
    this.host.disarmHookGrace(taskId);
    // Same reason as the two above: the flag is about the process, and the
    // process is the one being taken back.
    this.restarted.delete(taskId);
  }

  /** Reopen a suspended task (§4.3). Undefined when there is no such task.
   *
   * The whole ladder is walked before this returns, because the answer carries
   * the ptyId a client attaches to: falling back after someone attached would
   * leave them holding a terminal that is being killed. */
  async resumeTask(
    taskId: string,
    options: { fresh?: boolean; cols?: number; rows?: number } = {},
  ): Promise<TaskRow | undefined> {
    const row = this.host.store.get(taskId);
    if (!row) return undefined;
    // An archived task is not resumable, and this is the guard that says so.
    // It is load-bearing rather than defensive: `listArchivedTasks` hands the
    // sidebar's archived toggle exactly these ids, so a client *can* name one,
    // and the row is still in the database with a `branch` and a
    // `worktree_path` on it that `restoreTaskWorktree` would happily rebuild a
    // checkout from — off a branch the archive may have deleted. `unarchiveTask`
    // is the only door back: it puts the branch back first, flips the row to
    // `suspended`, and only then calls this.
    if (row.lifecycle === "archived") return undefined;
    // An archive already in flight settles first, and then this starts over
    // against the row it left — which will be archived, and refused above. It
    // is removing the checkout the ladder would restore and spawn into, and it
    // does not wait for resumes: it suspends the task, which waits for them.
    const archiveInFlight = this.inflight.archiving.get(taskId);
    if (archiveInFlight) {
      await archiveInFlight.catch(() => undefined);
      return this.host.resumeTask(taskId, options);
    }
    // A close already in flight settles first, and then this starts over
    // against the row it left. Suspend awaits a snapshot write before it kills
    // anything, so without this the checks below inspect a task whose PTYs are
    // moments from being killed: the "already running" arm hands back a ptyId
    // the close is about to kill, and the ladder arm spawns an agent the close
    // then kills along with the rest — undoing the user's close, or leaving
    // them attached to a corpse. Waiting means the resume is judged against the
    // task the close produced, which is the task as it now is.
    const suspendInFlight = this.inflight.suspending.get(taskId);
    if (suspendInFlight) {
      await suspendInFlight.done.catch(() => undefined);
      return this.host.resumeTask(taskId, options);
    }
    // An eviction already in flight settles first, for the same reason and with
    // more at stake: it is about to run `git worktree remove --force` on the
    // very directory the ladder would restore and spawn into. Waiting means the
    // resume is judged against the task the eviction produced — an evicted one,
    // which `restoreTaskWorktree` then rebuilds — rather than racing it for the
    // checkout. `evictTask` refuses in the other direction, so the two can
    // never wait on each other.
    const evictInFlight = this.inflight.evicting.get(taskId);
    if (evictInFlight) {
      await evictInFlight.catch(() => undefined);
      return this.host.resumeTask(taskId, options);
    }
    // Joined to a resume already in flight *before* anything is inspected. The
    // ladder adopts each rung's PTY before awaiting `awaitAgentStart`, so for
    // most of its run there is a live terminal on this task that belongs to a
    // rung still being judged — and the "already running" test below would read
    // it as success, answering a second caller with the ptyId of a terminal the
    // first caller is about to discard. That client attaches to a corpse and
    // nothing retries. Checked after the ladder too, since it may have finished
    // between the two.
    //
    // A fresh start does not join it, though: it is a request for a *new*
    // conversation, and handing back the in-flight resume answers 200 having
    // minted nothing — the same silent no-op the `fresh` test below exists to
    // prevent, just reached down the concurrent path. It waits for the ladder
    // in flight to settle instead (two of them on one task would have two
    // agents in one directory) and then starts over, by which point the
    // ordinary "already running" arm below discards whatever that resume left.
    const alreadyResuming = this.inflight.resuming.get(taskId);
    if (alreadyResuming) {
      if (options.fresh !== true) return alreadyResuming;
      await alreadyResuming.catch(() => undefined);
      return this.host.resumeTask(taskId, options);
    }
    // Already running. Resuming is what a client does on the way to opening a
    // task, so it has to be safe to ask for twice.
    //
    // "Running" has to mean the process is alive, not merely that we still
    // hold a handle to it: PtyManager only forgets a PTY when something kills
    // it, so one that exited on its own stays registered and `primaryPty` goes
    // on answering with the corpse. Testing the handle alone made this a
    // permanent no-op for the case resume most obviously exists to serve — an
    // agent that exited while the daemon stayed up. The route returned 200
    // with the dead terminal's ptyId, having spawned nothing, and only a
    // daemon restart (where reconcileOnBoot suspends the row) ever cleared it.
    const existing = this.host.primaryPty(taskId);
    // `fresh` is not a question about whether a conversation is already open —
    // it is a request for a new one, and the ladder it builds is a single
    // `--start` on a freshly minted id. Answering it with "already running"
    // returns 200 having minted nothing and spawned nothing, and the body
    // describes the old session, so the caller cannot tell. The live terminal
    // goes the way a dead one does; leaving it would have two agents on one
    // task.
    if (existing && options.fresh !== true && !existing.exited) return row;
    // Nothing is going to attach to a dead terminal again, and leaving it
    // associated would have the new agent's task still pointing at it.
    if (existing) this.discardPty(existing, taskId);

    const attempt = this.runResumeLadder(taskId, row, options).finally(() => {
      this.inflight.resuming.delete(taskId);
    });
    this.inflight.resuming.set(taskId, attempt);
    return attempt;
  }

  private async runResumeLadder(
    taskId: string,
    initial: TaskRow,
    options: { fresh?: boolean; cols?: number; rows?: number },
  ): Promise<TaskRow | undefined> {
    let row = initial;
    // Whatever the last process was is over. Cleared here rather than only on
    // the rung that succeeds, so a reopen that finds a resume rung this time —
    // a profile the user has since given a `resume` template — stops claiming
    // to be a restart.
    this.restarted.delete(taskId);

    // The checkout comes back before the conversation does (§5.6). Eviction is
    // not a lifecycle state of its own — it is `worktree_state` on a suspended
    // task — so opening one is an ordinary resume that happens to have a
    // directory to rebuild first, and putting it here rather than behind an
    // endpoint of its own means every door that reopens a task restores
    // without having to know it should: the pane, the CLI, the API.
    //
    // Inside the promise `resuming` holds, so it inherits the serialization
    // `resumeTask` already does against in-flight suspends and resumes. Two
    // concurrent restores of one task would be two `worktree add`s racing for
    // one path.
    //
    // A throw travels out to the route, which turns it into a status code the
    // client can act on. That is the point: a branch deleted while the task was
    // evicted is not a resume that failed, it is a workspace that needs a
    // decision, and walking the ladder against a directory that does not exist
    // would spawn agents in the daemon's own cwd.
    const restored = await this.host.restoreTaskWorktree(taskId);
    let setupCommand: string | null = null;
    if (restored) {
      // The checkout is new on disk, so whatever the card was showing is about
      // a directory that no longer exists in that form — and a restore that
      // applied a WIP snapshot has just changed the dirt count outright.
      void this.host.refreshWorktreeStatus(taskId, { force: true });
      // The row moved underneath us: `restoreTaskWorktree` writes `cwd`, and
      // `spawnAgent` reads it off the row it is handed. Without this the agent
      // is spawned in the directory the task had before the restore, which for
      // an evicted task is one that does not exist.
      row = this.host.store.get(taskId) ?? row;
      setupCommand = this.host.projects.find((p) => p.id === row.project_id)?.setupCommand ?? null;
      // What `recordSetupOutcome` dates the stamp against, so a restore
      // measures its own cost rather than inheriting the create's. That is what
      // makes the eviction grace self-correcting: the number it scales by is
      // the last restore's, not a guess made when the task was new.
      this.spawnedAt.set(taskId, Date.now());
    }

    const size = {
      // The grid the task had when it was suspended, so its output does not
      // reflow on the way back (§5.3).
      cols: options.cols ?? row.last_size_cols ?? DEFAULT_SIZE.cols,
      rows: options.rows ?? row.last_size_rows ?? DEFAULT_SIZE.rows,
    };

    for (const attempt of this.resumeLadder(row, options.fresh === true)) {
      // The task can be closed while the ladder is running: it awaits a spawn
      // and up to `startTimeoutMs` per rung, and deleteTask is one synchronous
      // DELETE away. Everything below assumes the row is still there — the
      // mint rung dereferences it outright, and the success arm hands the PTY
      // to `adopt`, which would re-register a terminal under a task that no
      // longer exists. Nothing kills that PTY afterwards (deleteTask already
      // walked the list it is being added back to) and nothing ever shows it,
      // so the agent runs on invisibly for the life of the daemon.
      if (!this.host.store.get(taskId)) return undefined;
      if (attempt.mint) {
        // A used id cannot be reused — `--session-id` on one that already has
        // a transcript fails with "already in use", so starting fresh on the
        // stored id would fail a second time and strand the task in a retry
        // loop (§4.3). The new id goes on the row before the spawn, so a
        // crash between the two leaves something resumable rather than a row
        // pointing at a conversation that was never opened.
        this.host.store.update(taskId, { agent_session_id: crypto.randomUUID() });
        row = this.host.store.get(taskId)!;
      }

      // The row is carrying the last process's verdict on itself: `exited`
      // with an exit code from the agent that went away, `could_not_resume`
      // from a resume that already failed, or `exited` from the rung before
      // this one. None of those survive a spawn, and none of them are states
      // anything else revisits — `inferState` only speaks about
      // starting/unknown/busy/idle, and the hook grace timer only downgrades
      // `starting`. Left alone, a resumed task whose agent reports no hooks
      // would read as dead for the rest of its life.
      row = this.host.store.update(taskId, { agent_state: "starting", exit_code: null }) ?? row;

      let pty: Pty;
      try {
        pty = await this.spawnAgent(row, { ...attempt, ...size, setupCommand });
      } catch {
        // The binary is missing or unrunnable: no rung will do better.
        break;
      }
      // Spent on the first rung. Setup is idempotent in principle and slow in
      // practice — a cold `bun install` is tens of seconds — and a ladder that
      // re-ran it per rung would turn one failed resume into four installs.
      const ranSetup = setupCommand !== null;
      setupCommand = null;

      const started = await this.awaitAgentStart(taskId, pty);
      // Checked again on the far side of the wait, which is where the window
      // actually is: a rung takes up to `startTimeoutMs` to settle, and a task
      // closed in the meantime must not end up owning the terminal we just
      // started for it.
      if (!this.host.store.get(taskId)) {
        this.discardPty(pty, taskId);
        return undefined;
      }
      if (started) {
        // What the user is looking at is a new process with no conversation
        // behind it, and only this loop knows which rung answered. Recorded
        // before the broadcast, so the very first `TaskInfo` a client sees for
        // the reopened task already carries it.
        if (attempt.mode === "restart") this.restarted.add(taskId);
        // A resume is the user opening the task, so it comes to the top
        // (TASK-116). Stamped here, on the rung that worked, rather than in
        // `adopt`, which every rung passes through: a ladder whose every rung
        // fails leaves the task suspended, and it must not have jumped the
        // list on the way.
        this.host.stampRank(taskId, Date.now(), { lifecycle: "live" });
        // The in-memory grouping only ever held the tasks *this* run created,
        // and a task worth resuming is by definition one it did not. Without
        // this the task is live and has a terminal, but `listTasks` — which
        // walks projects, not rows — cannot see it, so the very next
        // `broadcastTasks` sends every client a snapshot with the task they
        // just resumed missing from it.
        this.host.ensureInProject(taskId);
        this.host.broadcastTask(taskId);
        return this.host.store.get(taskId);
      }
      this.discardPty(pty, taskId);
      // A rung that failed with setup wrapped around it is usually setup's
      // failure, not the conversation's — the wrapper `exit`s rather than
      // `exec`ing the agent — and no other rung will do better against a
      // checkout that is not set up. Walking on would spawn a bare agent into
      // a half-built workspace and report it as a success.
      //
      // Only when the stamp says so. A setup still running is the common case
      // and not a failure at all: `awaitAgentStart` caps its wait at a few
      // seconds and answers on whether the process is still up, so a long
      // install is a *successful* rung whose output the user watches in the
      // tab. `readSetupOutcome` answers nothing while it is still going.
      if (ranSetup && (await this.setupFailed(taskId))) break;
    }

    // Nothing worked. The task is not a dead terminal and not a lie about
    // being live — it is a card with a button on it (§4.3).
    //
    // Which means the lifecycle has to be written and not merely left alone: a
    // row that was already `live` when the ladder started — an agent that
    // exited on its own, with the user then pressing the retry overlay's
    // button — would keep saying `live` with `ptyId: null`, which is the lie.
    // Nothing recovers it either, because everything that would reopen the task
    // asks for one of the two states this is between: `AgentPane` only reopens
    // a `suspended` task, and the harvester only
    // takes an `idle` one. Left `live` the card sits in the sidebar dead for the
    // life of the daemon; left `suspended` it is what it looks like, and the
    // next click walks the ladder again.
    this.host.store.update(taskId, { lifecycle: "suspended", agent_state: "could_not_resume" });
    this.host.broadcastTask(taskId);
    return this.host.store.get(taskId);
  }

  /** Whether the setup wrapper has recorded a failure for this task.
   *
   * Distinct from "setup did not finish", which is what a task still
   * installing looks like and is not a reason to stop trying. */
  private async setupFailed(taskId: string): Promise<boolean> {
    const spawnedAt = this.spawnedAt.get(taskId);
    if (spawnedAt === undefined) return false;
    const outcome = await readSetupOutcome(setupStampPath(taskId), spawnedAt);
    return outcome !== undefined && outcome.exitCode !== 0;
  }

  /** The rungs to try, in order (§4.3). A fresh start is not a rung — it is
   * the user choosing to stop trying. */
  private resumeLadder(
    row: TaskRow,
    fresh: boolean,
  ): Array<{ mode: AgentMode; sessionId?: string; mint?: boolean }> {
    if (fresh) return [{ mode: "start", mint: true }];

    const ladder: Array<{ mode: AgentMode; sessionId?: string; mint?: boolean }> = [];
    // `get`, not `require`. The row holds a profile *name*, and `profiles.json`
    // is the user's file: one they edited between creating this task and
    // reopening it can name a profile this daemon no longer has. There is
    // nothing to render an argv through, so the ladder is empty — which
    // `runResumeLadder` turns into `could_not_resume`, a card saying the task
    // could not be brought back. A throw here would instead travel out of
    // `resumeTask` to the route as a 500 on an ordinary click.
    const profile = this.host.profiles.get(row.agent_profile);
    if (!profile) return [];
    const capabilities = profileCapabilities(profile);

    // Every rung below the first is derived from Claude Code's own transcript
    // directory — `canResumeSessionId`, `sessionIdFromTranscript`,
    // `continueIsSafe` and `findResumableTranscript` all read files it writes —
    // so none of them says anything about another agent, whose conversations
    // live wherever that agent puts them (pi keeps its own per directory). For
    // any other profile the ladder is what the templates themselves claim: the
    // stored id if it can resume by id, then its directory-scoped fallback if
    // it has one.
    //
    // A profile with neither gets a restart: the start command again, in the
    // task's own directory, with no prompt and keeping the row's session id
    // where the template names one (TASK-89.4). It is not a resume and is not
    // dressed as one — `TaskInfo.restarted` says so and the agent pane prints
    // the sentence — but it is a great deal better than a dead card for the two
    // cases that reach it: a shell task, whose whole purpose is a terminal in
    // that directory, and any agent whose conversations we have no way to name.
    if (profile.name !== DEFAULT_PROFILE) {
      if (capabilities.resume && row.agent_session_id) {
        ladder.push({ mode: "resume", sessionId: row.agent_session_id });
      }
      if (capabilities.continue) ladder.push({ mode: "continue" });
      if (!capabilities.resume && !capabilities.continue) ladder.push({ mode: "restart" });
      return ladder;
    }

    // Everything below is `claude`, whose templates are the built-in ones —
    // unless the user replaced it, which `profiles.json` lets them do wholesale.
    // So the capabilities still gate the rungs: a replacement that dropped
    // `--resume` or `--continue` would otherwise reach `buildAgentCommand`,
    // throw "cannot resume", and be read by the ladder as an unrunnable binary
    // — which stops it trying the rungs that would have worked.
    //
    // Offered only when a transcript for that id is actually there. This has
    // to be decided up front rather than discovered: a `--resume` on an id
    // with no conversation exits 1 down a pipe, but in a PTY it prints the
    // error and keeps running, so a doomed rung is indistinguishable from a
    // healthy one once it has started.
    if (capabilities.resume && row.agent_session_id && canResumeSessionId(row, row.agent_session_id)) {
      ladder.push({ mode: "resume", sessionId: row.agent_session_id });
    }
    // The conversation the task itself last reported, when that is not the one
    // the row names. The row's id can go stale — a `/clear` we missed, a
    // hand-edited database — while `transcript_path` came from the agent's own
    // SessionStart and names its file directly. Resuming by id from that
    // filename is both precise and cheap, and it is the rung that recovers a
    // task whose stored id no longer means anything.
    //
    // Gated through `canResumeSessionId`, not a bare `transcriptExists` of the
    // recorded path: the reported id's transcript is subject to the same
    // mid-session relocation as the stored id's (TASK-104), so a worktree
    // switch that moved it into `projectsDirFor(cwd)` leaves the recorded path
    // naming a folder it has left. Sharing the one helper is what keeps both
    // id rungs relocation-aware rather than patching only the first.
    const reported = sessionIdFromTranscript(row.transcript_path);
    if (
      capabilities.resume
      && reported && reported !== row.agent_session_id && canResumeSessionId(row, reported)
    ) {
      ladder.push({ mode: "resume", sessionId: reported });
    }
    // "The most recent conversation in this directory" — but only when that is
    // demonstrably this task's. §4.3 calls `--continue` unambiguous on the
    // strength of worktree-per-task, and until worktrees land (m-4) a
    // directory can hold several conversations: another task's, or the one
    // belonging to whoever is running an agent there by hand. Verified the
    // hard way — a resume in this repo picked up the conversation of the
    // session doing the work. Opening someone else's conversation is worse
    // than not resuming at all.
    //
    // "Demonstrably" is the whole of it, and it excludes the row that can
    // demonstrate nothing (TASK-43). Reaching here means the rungs above
    // declined or failed the minted id — so a row that never reported a
    // transcript has no conversation of its own in that directory, and the
    // most recent one there is by elimination somebody else's. The guard used
    // to wave that case through on the grounds that it could not tell.
    if (capabilities.continue && continueIsSafe(row)) ladder.push({ mode: "continue" });
    // §4.3's last rung: scan the directory for a conversation nobody ever told
    // us about. Offered only in a checkout we made for this task, and that
    // gate is the whole of TASK-60.
    //
    // Why it needs one. Follow what the scan can return in a directory the
    // user chose, given `--continue` above is gated on "the newest transcript
    // is demonstrably ours". If that gate passed, the newest *is* ours and the
    // rungs above have already offered it by id and by `--continue`, so the
    // scan can only reach past it to something older, which nothing has shown
    // to be this task's. If the gate failed, the scan has to be refused for
    // the reason the gate was: declining `--continue` because the newest
    // conversation belongs to a stranger, and then opening that very file by
    // id one rung later, would make the guard theatre. Either way it yields a
    // conversation we never started or nothing at all — which is why TASK-43
    // took the rung off rather than gating it, and why it stays off for a task
    // running where the user pointed it.
    //
    // A worktree removes the stranger from both halves. `worktreePathFor`
    // derives the directory from the task's id, we created it, and nothing
    // else runs there — so every conversation in it, inside the task's
    // lifetime, is this task's whether or not anything ever named it. Which
    // makes both of the scan's outcomes worth having, where in a shared
    // directory neither was: the newest conversation when nothing named it —
    // §4.3's case, and the one TASK-43 could not keep, a degraded task (hooks
    // never arrived, so no SessionStart set `transcript_path`) whose agent then
    // ran `/clear` — and the one *behind* the newest when the newest will not
    // open, which is what "transcript pruned, version skew" leaves to fall back
    // on. An older conversation of this task's is a poor resume and a much
    // better answer than a card saying nothing could be opened.
    //
    // Note this is strictly sharper than `--continue`, not a second helping of
    // it: it resumes the found conversation *by id*, so it says which one it
    // opened, and the rung above stays gated as it is rather than being
    // loosened in a worktree.
    if (capabilities.resume && runsInOwnWorktree(row)) {
      const found = findResumableTranscript(row, {
        // Every id the ladder can name, offered or not. An id with no
        // transcript is skipped above and would find nothing here either, and
        // one that *was* offered must not come back a second time — most of
        // all through `--continue`, which opens the newest file in the
        // directory, which is exactly what the scan would hand back next.
        notThese: [row.agent_session_id, reported],
      });
      // No `canResumeSessionId` here: the scan found the file, so the rung it
      // builds cannot be the doomed `--resume` that check exists to keep off.
      if (found) ladder.push({ mode: "resume", sessionId: found.sessionId });
    }
    return ladder;
  }
}
