import type { ServerWebSocket } from "bun";
import type { ProcessRoot } from "../processes";
import { taskEnv } from "../agent/spawn";
import type { Pty } from "../xtmux/pty";
import { PtyManager } from "../xtmux/pty-manager";
import { sendFrame } from "../xtmux/socket";
import type { WebSocketData } from "../xtmux/types";
import { resolveRepoRoot } from "./derive";
import type { TaskHost } from "./host";
import { DEFAULT_SIZE } from "./task-info";

/** The PTY side of a task: the processes, which task each belongs to, which
 * one is the agent's, the clients attached to them, and the live directory
 * read off the agent's. Split out of TaskManager (TASK-152). */
export class TaskTerminals {
  ptys = new PtyManager();
  // Both directions. taskPtys because a task's terminals must all die with it;
  // ptyToTask because everything a PTY reports — output, a title, a
  // notification — has to be readdressed to the task before it goes out.
  private ptyToTask: Map<string, string> = new Map();
  taskPtys: Map<string, Set<string>> = new Map();
  // Which of a task's terminals is the agent's (§3). Held apart from the set
  // above rather than inferred from it, because the set is unordered in every
  // way that matters: `resumeTask` on a *live* task — an agent that exited, or
  // a `fresh: true` — discards the old agent and adopts the new one after
  // whatever shell tabs are open, so "the first live PTY the task holds" would
  // answer with a shell. Everything that means *the agent* reads through here:
  // `taskInfo.ptyId` (what a client attaches its agent tab to), `snapshot`,
  // `refreshCwd`, and resume's own already-running test.
  agentPtys: Map<string, string> = new Map();
  // When each task's directory was last checked against its live terminal.
  // The data routes ask on every request; this is what keeps that from being a
  // process spawn every time (TASK-41).
  cwdCheckedAt: Map<string, number> = new Map();
  private cwdRefreshWindowMs = 3_000;

  constructor(private readonly host: TaskHost) {}

  /** How long a task's directory is trusted before the terminal is asked
   * again. Zero asks every time, which is what a test wants and what nothing
   * else does. */
  setCwdRefreshWindow(ms: number): void {
    this.cwdRefreshWindowMs = ms;
  }

  /**
   * Wire a PTY to a task: the association, plus the callbacks that readdress
   * what the PTY reports to the task that owns it.
   *
   * `agent` is what separates the two kinds of terminal a task can hold (§3),
   * and it decides far more than which map an id goes in. Everything below the
   * ownership lines is the task speaking about *its agent* — that the
   * conversation exited, what the agent is calling itself, whether it is
   * working — and a shell tab has no standing to say any of it. Left
   * undifferentiated, typing `exit` in a shell would record the task's agent as
   * dead, a shell's OSC title would become the task's label, and a build
   * running in a shell would drive the busy/idle inference that stands in for
   * the agent's own hooks in degraded mode. `openShell` passes false; every
   * other caller is spawning the agent.
   */
  adopt(pty: Pty, taskId: string, agent = true): void {
    this.ptyToTask.set(pty.id, taskId);
    let held = this.taskPtys.get(taskId);
    if (!held) {
      held = new Set();
      this.taskPtys.set(taskId, held);
    }
    held.add(pty.id);

    if (!agent) {
      this.adoptShell(pty, taskId);
      return;
    }
    this.agentPtys.set(taskId, pty.id);
    // The seeded edge is what the agent's first burst is measured from
    // (TASK-116), and why an agent PTY always has one: its first output right
    // after the spawn is not a wake. Keyed by this PTY, so a rung that fails
    // takes its entry with it (`discardPty`) and the next one seeds its own.
    //
    // Only the edge. The rank is stamped where the task is known to have
    // started — `createTask`, and the resume ladder's successful rung — and
    // not here, because every rung of a resume is adopted, and a resume whose
    // every rung fails leaves the task suspended: it did not start, and must
    // not jump the list as if it had.
    this.host.seedOutputEdge(pty.id, Date.now());

    pty.onExit((code) => {
      // Only if this is still the task's terminal. A rung of the resume ladder
      // that did not work out is killed on the way to the next one, and its
      // exit callback lands afterwards — asynchronously, and therefore after
      // the successful rung has already written `starting`. Without this, a
      // task that resumed perfectly well on the second attempt advertises the
      // first attempt's death for the rest of its life.
      if (this.ptyToTask.get(pty.id) !== taskId) return;
      this.host.store.update(taskId, { agent_state: "exited", exit_code: code });
      this.host.broadcastTask(taskId);
    });
    // The terminal title is part of every task's info, and clients project it
    // over the stored title at render time — so a change only has to be sent.
    pty.onTitleChange(() => {
      this.host.broadcastTask(taskId);
    });
    pty.onActivityChange((_ptyId, active) => {
      // Same guard as `onExit`, and for a synchronous reason: `kill` sends a
      // falling edge from inside the call, and every site that kills a PTY
      // unmaps it first (`unmapAndKill`) so that edge cannot stamp, re-record
      // an output edge for, or announce a PTY that is on its way out.
      if (this.ptyToTask.get(pty.id) !== taskId) return;
      // Recency is worth a write — but not a row broadcast, which is what the
      // activity message is for. The stamps ride that message, so a client can
      // update the row without being sent one: the write is otherwise
      // invisible until the next full snapshot, which is how a busy task used
      // to sink under shorter ones started after it (TASK-101).
      //
      // Two stamps, because these edges are far too frequent to sort by: the
      // PTY goes idle after 300ms of silence, so an agent pausing to think or
      // run a tool rises again several times a minute, and a list ordered by
      // every rising edge had its busy tasks racing each other for the top
      // (TASK-116). `last_active_at` still moves on every edge and is what the
      // age column and the harvester read; `rank_at`, the sort key, moves only
      // on a wake after `RERANK_QUIET_MS` in which this terminal produced no
      // output, and only if the rank itself is that old. Output, not
      // `last_active_at`: hooks stamp that as well, and Claude Code's
      // `idle_prompt` Notification fires about a minute into a silent prompt —
      // counted as activity, it would restart the gap just as it closed and
      // keep the task the user comes back to from rising. See `stampActivity`.
      // Typing into the task wakes it too, through `writeToPty`.
      const now = Date.now();
      const { rankAt } = this.host.stampActivity(taskId, pty.id, active, now, true);
      // Degraded mode (§9, risk 4). An agent run with hooks disabled, or one
      // whose payloads a future version has changed, reports nothing — and a
      // task list that says `starting` forever is worse than v1's guess. So
      // for a task that has never reported a hook, output activity stands in
      // for busy/idle, exactly as v1 inferred it. The moment any hook arrives
      // this goes back to being about recency alone, and never fights the
      // agent's own account of itself.
      if (!this.host.hasSeenHook(taskId)) this.host.inferState(taskId, active);
      this.host.broadcastToAll({
        type: "activity", taskId, active, at: now,
        ...(rankAt !== undefined ? { rankAt } : {}),
      });
    });
    pty.onNotification((_ptyId, title, body) => {
      this.host.broadcastToAll({ type: "notification", taskId, title, body });
      this.host.broadcastTask(taskId);
    });
  }

  /**
   * The much smaller half of `adopt`: what a shell tab is allowed to report.
   *
   * A shell is a process in the task's directory, not a voice for the task. So
   * its output moves the task's age — something happened there — and it tells
   * clients when it dies, because a tab bound to a PTY that is gone has to stop
   * being drawn (§5.5, and `pruneShellTabs`).
   * It does not touch `agent_state`, does not become the task's
   * `terminalTitle`, does not feed the degraded-mode inference, and raises no
   * notifications: those are all claims about the conversation.
   *
   * No `activity` message either, for a reason worth stating: activity is
   * addressed to the *task*, and the sidebar's dot is edge-triggered off it. A
   * shell and an agent both emitting would have each one's falling edge clear
   * the other's dot, so a build finishing would put out the light on an agent
   * still mid-turn.
   *
   * Its output never moves the task's rank (TASK-116). A dev server or a
   * `watch` in a shell tab logs every minute or two for as long as it runs,
   * and ranked like the agent's output it would bounce its task to the top on
   * every burst — the very shuffle the rank exists to stop. Shell output says
   * a process is running, not that the user is here. Typing is the user being
   * here, and input to any of the task's terminals, shells included, wakes it
   * through `writeToPty`. Nor does it keep the agent from waking: the agent's
   * quiet is measured from the agent's own edges, or a dev server logging
   * every thirty seconds would hold its task in place for as long as it ran.
   *
   * A row broadcast, though, on the falling edge — because between full
   * snapshots that is the only carrier the age stamp has (TASK-101), and the
   * falling edge's is the one the age column shows: when output stopped.
   * Without it the sidebar's age lags until some unrelated delta happens
   * along. It is safe where an `activity` frame would not be: a `task` delta
   * says what the row is now, and has no falling edge to clear the agent's dot
   * with.
   *
   * And on a rising edge that follows a long gap in this shell's own output,
   * because otherwise a three-minute build in a task last touched two hours
   * ago has no falling edge until it ends, and the sidebar says "2h ago" for
   * the whole of it. That is the only thing the shell's entry in
   * `outputEdgeAt` is for. It is seeded when the shell is adopted, as the
   * agent's is, so the prompt drawn on open is not a long gap: its falling
   * edge 300ms later already carries the stamp, and a rising-edge broadcast
   * too would only send the same row twice.
   * Not on a rising edge after a short one, which is most of them: the age
   * column would move by seconds at most, and the falling edge 300ms later
   * carries a fresher stamp anyway.
   */
  private adoptShell(pty: Pty, taskId: string): void {
    this.host.seedOutputEdge(pty.id, Date.now());
    pty.onExit(() => {
      // Only if the task still holds it: `discardPty` and `doSuspend` both kill
      // shells on their way past, and an exit callback landing after the task
      // has been deleted would broadcast a row that is no longer there.
      if (this.ptyToTask.get(pty.id) !== taskId) return;
      this.host.broadcastTask(taskId);
    });
    pty.onActivityChange((_ptyId, active) => {
      // The agent handler's guard, for the same synchronous kill-time edge.
      if (this.ptyToTask.get(pty.id) !== taskId) return;
      const { longGap } = this.host.stampActivity(taskId, pty.id, active, Date.now(), false);
      if (!active || longGap) this.host.broadcastTask(taskId);
    });
  }

  /**
   * Kill some of a task's PTYs, each unmapped before its kill.
   *
   * `kill` fires a mid-burst PTY's falling edge from inside the call, and the
   * activity handlers' ownership guard is what keeps that edge from stamping
   * the age, recording an output edge, and — for a shell — sending a `task`
   * delta that every caller is about to send, or has no row left to send.
   * Nothing needs that edge but one thing, which this sends instead: if the
   * agent's terminal was among them and mid-burst, a bare falling edge, so
   * the liveness clients hold per task (`useGitHistory` refetches refs on its
   * falling edge) does not stay stuck on for a process that is gone. Bare —
   * no stamps — because nothing was stamped.
   *
   * Leaves `agentPtys` to the caller, which knows whether the slot empties.
   */
  unmapAndKill(taskId: string, ptyIds: readonly string[]): void {
    const agentPty = this.agentPtys.get(taskId);
    const agentWasActive = agentPty !== undefined && ptyIds.includes(agentPty)
      && this.ptys.get(agentPty)?.isActive === true;
    for (const ptyId of ptyIds) {
      this.ptyToTask.delete(ptyId);
      this.taskPtys.get(taskId)?.delete(ptyId);
      this.host.forgetOutputEdge(ptyId);
      this.ptys.kill(ptyId);
    }
    if (agentWasActive) this.host.broadcastToAll({ type: "activity", taskId, active: false });
  }

  /** The id in the task's agent slot, whether or not the PtyManager still
   * holds that terminal — `primaryPty` answers only for one it does. */
  agentPtyId(taskId: string): string | undefined {
    return this.agentPtys.get(taskId);
  }

  /** Empty the task's agent slot, which `unmapAndKill` leaves to its caller. */
  forgetAgentPty(taskId: string): void {
    this.agentPtys.delete(taskId);
  }

  taskIdForPty(ptyId: string): string | undefined {
    return this.ptyToTask.get(ptyId);
  }

  /** The task's agent terminal — the one its agent tab opens onto, the one a
   * snapshot is taken of, and the one asked where the task is. A task holds
   * shell tabs beside it (§3); none of them is ever this. */
  primaryPty(taskId: string): Pty | undefined {
    const ptyId = this.agentPtys.get(taskId);
    return ptyId === undefined ? undefined : this.ptys.get(ptyId);
  }

  /** Where a task's process tree hangs from (TASK-138.1): the pid of each of
   * its terminals still running, the agent's first. Empty for a task with
   * none — suspended, evicted, or one whose every program has exited. */
  processRoots(taskId: string): ProcessRoot[] {
    const roots: ProcessRoot[] = [];
    const agentPid = this.host.primaryPty(taskId)?.pid;
    if (agentPid != null) roots.push({ pid: agentPid, terminal: "agent" });
    for (const shell of this.host.shellPtys(taskId)) {
      if (shell.pid != null) roots.push({ pid: shell.pid, terminal: "shell" });
    }
    return roots;
  }

  /** The task's shell terminals, in the order they were opened. What
   * `TaskInfo.shellPtyIds` carries, and so what a client reconciles a restored
   * tab layout against. */
  shellPtys(taskId: string): Pty[] {
    const agentPtyId = this.agentPtys.get(taskId);
    const shells: Pty[] = [];
    for (const ptyId of this.taskPtys.get(taskId) ?? []) {
      if (ptyId === agentPtyId) continue;
      const pty = this.ptys.get(ptyId);
      if (pty) shells.push(pty);
    }
    return shells;
  }

  /**
   * Open a plain shell as a sibling of the task's agent (§3, §5.5).
   *
   * Undefined when the task is not live: a shell belongs to a task's running
   * state, and spawning one against a suspended row would resurrect half a task
   * — a process in the working directory of a conversation nobody has resumed,
   * which the next harvest would not even find, since the harvester only walks
   * live rows.
   *
   * Same environment as the agent, deliberately. A user who types `claude` in a
   * shell tab is otherwise running inside the task's inherited marker, and the
   * hooks that agent fires would be filed against this task's conversation.
   *
   * Spawned at the task's own grid rather than at `PtyManager`'s 80×24 fallback
   * when the caller names no size. The route that opens a shell has no terminal
   * yet — the tab is drawn from its answer — so nobody is in a position to
   * measure one, and left to the fallback the shell paints its first prompt
   * laid out for 80 columns and reflows the moment the tab attaches. The agent
   * is spawned at a real grid for the same reason.
   */
  openShell(taskId: string, options: { cols?: number; rows?: number } = {}): Pty | undefined {
    const row = this.host.store.get(taskId);
    if (!row || row.lifecycle !== "live") return undefined;
    // The agent's live grid, else the one the task was last seen at. Both are
    // what `taskInfo.size` reports, which is the size every client showing this
    // task has already negotiated down to.
    const taskSize = this.host.primaryPty(taskId)?.getSize() ?? {
      cols: row.last_size_cols ?? DEFAULT_SIZE.cols,
      rows: row.last_size_rows ?? DEFAULT_SIZE.rows,
    };
    const pty = this.ptys.spawn([process.env.SHELL || "/bin/sh"], {
      cols: options.cols ?? taskSize.cols,
      rows: options.rows ?? taskSize.rows,
      cwd: row.cwd,
      env: taskEnv(process.env, { taskId, port: this.host.port, origin: this.host.origin }),
    });
    this.adopt(pty, taskId, false);
    this.host.broadcastTask(taskId);
    return pty;
  }

  /**
   * Close one of a task's shells. False when the task does not hold that PTY,
   * which includes the case worth being explicit about: the agent's own
   * terminal is not closable through this door. Killing it here would leave the
   * row saying `live` with no conversation behind it and no snapshot taken —
   * `closeTask` is how a task is put down (§6).
   */
  closeShell(taskId: string, ptyId: string): boolean {
    if (this.ptyToTask.get(ptyId) !== taskId) return false;
    if (this.agentPtys.get(taskId) === ptyId) return false;
    // Unmapped before the kill: a mid-burst shell's kill-time falling edge
    // would otherwise stamp the row and send a `task` delta of its own ahead
    // of the one below.
    this.unmapAndKill(taskId, [ptyId]);
    this.host.broadcastTask(taskId);
    return true;
  }

  /** Every terminal a task is holding: the agent's, and any shell tabs opened
   * beside it (§3). What the harvester counts attached views over and asks
   * what is running, and what `suspendTask` kills. */
  taskPtyList(taskId: string): Pty[] {
    const held: Pty[] = [];
    for (const ptyId of this.taskPtys.get(taskId) ?? []) {
      const pty = this.ptys.get(ptyId);
      if (pty) held.push(pty);
    }
    return held;
  }

  /** A live PTY by id, for the routes that serialize or write to one. */
  getPty(ptyId: string): Pty | undefined {
    return this.ptys.get(ptyId);
  }

  /** refreshCwd, but at most once every `maxAgeMs` for a given task.
   *
   * This is what lets the data routes ask on every request. They have to ask
   * somewhere: §5.4 moved them off "run git per request" and onto the stored
   * row, and the row then needs something to notice when the agent has moved.
   * Attach was doing that job, but a client only re-attaches when it changes
   * task — so a user moving between one task's own Changes, Files and History
   * tabs never triggered it, and a single-task user never triggered it at all.
   *
   * Affordable only because getCwd stopped blocking the event loop (TASK-40);
   * before that this would have put a synchronous ps and lsof in front of
   * every diff request. */
  async refreshCwdIfStale(taskId: string, maxAgeMs = this.cwdRefreshWindowMs): Promise<string | undefined> {
    // Nothing to throttle, and nothing to remember. The data routes call this
    // with whatever id is in the URL, so recording a timestamp before knowing
    // the task exists would grow this map by one entry per bad request and
    // never free them — suspending or deleting the task is the only thing that
    // prunes it.
    if (!this.host.store.get(taskId)) return undefined;
    const last = this.cwdCheckedAt.get(taskId);
    if (last !== undefined && Date.now() - last < maxAgeMs) {
      return this.host.store.get(taskId)?.cwd;
    }
    this.cwdCheckedAt.set(taskId, Date.now());
    return this.host.refreshCwd(taskId);
  }

  /** The one thing a live PTY is still better at than the row: noticing the
   * agent has cd'd somewhere unexpected (§5.4). Opportunistic — callers ask
   * when they happen to be listing tasks anyway, and a suspended task simply
   * has nothing to report. Re-resolves repo_root when the directory moved, or
   * when the row is still carrying a null root, since that is a git call. */
  async refreshCwd(taskId: string): Promise<string | undefined> {
    const task = this.host.store.get(taskId);
    if (!task) return undefined;
    const live = await this.host.primaryPty(taskId)?.getCwd();
    const moved = !!live && live !== task.cwd;
    // A null root is the one value worth re-asking about even when nothing
    // moved, because this is the only thing that ever revisits it. createTask
    // has to record "the lookup could not run" (git contending on index.lock,
    // a stalled mount) as "no repository" — there is no earlier value for it
    // to keep — and `git init` inside a task's own directory is a repository
    // appearing under a cwd that never changes. Either way the task's diff,
    // file and git routes would 400 for the rest of its life. Re-asking costs
    // one `rev-parse` that exits 128 immediately when the answer really is no.
    if (!moved && task.repo_root !== null) return task.cwd;

    // undefined means the lookup could not be performed (git unavailable, or
    // slow enough to hit the timeout). Keeping the root we already had is the
    // only safe answer: writing null on an absent answer would 400 the task's
    // data routes until something moves.
    const resolved = await resolveRepoRoot(live ?? task.cwd);
    const repoRoot = resolved === undefined || resolved === task.repo_root ? undefined : resolved;
    if (!moved && repoRoot === undefined) return task.cwd;
    this.host.store.update(taskId, {
      ...(moved ? { cwd: live } : {}),
      ...(repoRoot === undefined ? {} : { repo_root: repoRoot }),
    });
    this.host.broadcastTask(taskId);
    return live ?? task.cwd;
  }

  acknowledgeTask(taskId: string): void {
    let acknowledged = false;
    for (const ptyId of this.taskPtys.get(taskId) ?? []) {
      const pty = this.ptys.get(ptyId);
      if (pty?.hasNotification) {
        pty.acknowledge();
        acknowledged = true;
      }
    }
    if (acknowledged) this.host.broadcastTask(taskId);
  }

  attachClient(
    ptyId: string,
    clientId: string,
    ws: ServerWebSocket<WebSocketData>,
    cols?: number,
    rows?: number,
  ): Pty | undefined {
    if (!this.ptys.has(ptyId)) return undefined;
    // Sent *before* the attach, and therefore before the PTY's `restore`: it
    // is what tells the client which terminal the traffic that follows belongs
    // to. A client filters terminal messages against the PTY it is showing, so
    // learning the pairing afterwards would mean dropping its own restore. The
    // task id has to come from here — a Pty has no notion of one.
    const taskId = this.ptyToTask.get(ptyId);
    sendFrame(ws, JSON.stringify({ type: "attached", ptyId, taskId: taskId ?? ptyId }));

    // Opening a task's terminal is the moment before its Changes, Files and
    // History tabs get used, and it is the only such moment the browser
    // reaches — GET /api/tasks is CLI-only. Without this, a task created in a
    // directory the agent then cd'd out of would keep answering those tabs
    // from the root it had at creation, or 400 them forever if it had none.
    // Fire-and-forget: it broadcasts a delta if anything moved, and a failure
    // to notice is not a reason to refuse the attach.
    if (taskId) void this.host.refreshCwdIfStale(taskId).catch(() => {});

    const pty = this.ptys.attach(ptyId, clientId, ws, cols, rows);
    // Who else is looking at this task, and at what size, both ride on
    // TaskInfo and both change here — but nothing else about the task does, so
    // without this the count only reaches other clients when an unrelated
    // delta happens to come along. Multi-client is the point of the product
    // (§5.4); a stale audience is worse than none shown.
    if (pty && taskId) this.host.broadcastTask(taskId);
    return pty;
  }

  /** Detach one terminal, or every one the client holds when omitted (the
   * socket closed). */
  detachClient(clientId: string, ptyId?: string): void {
    // Same reasoning as attachClient, over however many terminals went at
    // once. Deduped by task: a client holding a task's agent tab and two of
    // its shells is one row's worth of change, not three.
    const detached = this.ptys.detach(clientId, ptyId);
    const taskIds = new Set<string>();
    for (const id of detached) {
      const taskId = this.ptyToTask.get(id);
      if (taskId) taskIds.add(taskId);
    }
    for (const taskId of taskIds) this.host.broadcastTask(taskId);
  }

  /** False when the client is not attached to the terminal it named —
   * attachment is the authorization, so the caller can report it rather than
   * dropping the keystroke silently. */
  writeToPty(clientId: string, ptyId: string, data: string): boolean {
    // After the write, and only when it went through: a keystroke refused for
    // want of an attach is nobody being here. The data goes along because not
    // all of it is typed — xterm.js answers queries and reports focus through
    // this same door. See `wakeOnInput`.
    const ok = this.ptys.write(clientId, ptyId, data);
    if (ok) this.host.wakeOnInput(ptyId, data);
    return ok;
  }

  /** Type into a terminal on the user's behalf — what the server writes for
   * something they did elsewhere, like the paths of files dropped on a task's
   * terminal (`api/uploads.ts`). No client check: the route that calls it has
   * already scoped the PTY to the task. It wakes the task as `writeToPty`
   * does, because a drop is as much the user being here as a keystroke.
   * False when the terminal is gone or has exited, since `Pty.write` drops
   * the data silently then. */
  typeIntoPty(ptyId: string, data: string): boolean {
    const pty = this.ptys.get(ptyId);
    if (!pty || pty.exited) return false;
    pty.write(data);
    this.host.wakeOnInput(ptyId, data);
    return true;
  }

  /** False on the same unattached-client check as writeToPty. A stale resize
   * is not worth an error reply — a client that just detached will re-measure
   * on its next attach — but the answer is the layer below's to give, not this
   * one's to swallow. */
  resizePty(clientId: string, ptyId: string, cols: number | null, rows: number | null): boolean {
    const before = this.ptys.get(ptyId)?.getSize();
    if (!this.ptys.resize(clientId, ptyId, cols, rows)) return false;
    // The other half of what attachClient broadcasts. Smallest-wins means one
    // client's window is every client's grid, and the grid rides on TaskInfo —
    // so without this the status bar of every *other* viewer goes on naming a
    // size their terminal has already stopped being.
    //
    // Narrow on purpose: only the terminal TaskInfo actually reports (a shell
    // tab's grid is not the task's), and only when the negotiated size moved.
    // A drag is a burst of resize messages and almost none of them renegotiate
    // anything.
    const after = this.ptys.get(ptyId)?.getSize();
    const taskId = this.ptyToTask.get(ptyId);
    if (
      taskId &&
      before &&
      after &&
      (before.cols !== after.cols || before.rows !== after.rows) &&
      this.host.primaryPty(taskId)?.id === ptyId
    ) {
      this.host.broadcastTask(taskId);
    }
    return true;
  }

  getClientPtyIds(clientId: string): string[] {
    return this.ptys.clientPtyIds(clientId);
  }
}
