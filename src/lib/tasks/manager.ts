import type { ServerWebSocket } from "bun";
import type { Database } from "bun:sqlite";
import * as fs from "fs";
import * as os from "os";
import type { Pty } from "../xtmux/pty";
import { PtyManager } from "../xtmux/pty-manager";
import type { ProjectInfo, ServerMessage, TaskInfo, WebSocketData } from "../xtmux/types";
import { uniqueName } from "../xtmux/naming";
import * as db from "../db";
import type { TaskRow } from "../db";
import { TaskStore } from "./store";
import { buildAgentCommand, taskDir, taskEnv, type AgentMode } from "../agent/spawn";
import {
  canResumeSessionId,
  continueIsSafe,
  findResumableTranscript,
  sessionIdFromTranscript,
  transcriptExists,
} from "../agent/transcripts";
import { writeTaskSettings } from "../agent/settings";
import { transitionFor, type HookPayload } from "../agent/hook-state";
import { deriveTitle, resolveRepoRoot } from "./derive";

function expandTilde(filepath: string): string {
  if (filepath.startsWith("~/") || filepath === "~") {
    return os.homedir() + filepath.slice(1);
  }
  return filepath;
}

const DEFAULT_SIZE = { cols: 80, rows: 24 };

export interface CreateTaskOptions {
  id: string;
  title?: string;
  prompt?: string;
  projectId?: string;
  /** Inherit the cwd of this task's terminal, and sit next to it in the list. */
  afterTaskId?: string;
  cols?: number;
  rows?: number;
  /** Recorded on the row, and passed through to the agent's argv. */
  model?: string;
  permissionMode?: string;
  /** Overrides what the task's first terminal runs. A task runs its agent by
   * default — that is what a task *is* (§3) — so this is for the callers that
   * want something else in front of a task: tests, and the extra shell tabs
   * TASK-27 opens. */
  command?: string[];
  /** The id to give that terminal. Minted when omitted — a task and its
   * terminals are separate things with separate lifetimes, and a resumed task
   * (TASK-13) keeps its id while getting a new PTY. Clients read
   * TaskInfo.ptyId rather than assuming any relationship. */
  ptyId?: string;
}

// The policy layer (docs/v2-architecture.md §5.2), and the only place that
// knows a task can exist without a process. It holds the rows through
// TaskStore, the processes through PtyManager, and the association between
// them — which is the whole point of the split, since a task outlives its
// terminals and eventually has more than one.
export class TaskManager {
  private ptys = new PtyManager();
  private database?: Database;
  // Both directions. taskPtys because a task's terminals must all die with it;
  // ptyToTask because everything a PTY reports — output, a title, a
  // notification — has to be readdressed to the task before it goes out.
  private ptyToTask: Map<string, string> = new Map();
  private taskPtys: Map<string, Set<string>> = new Map();
  private projects: ProjectInfo[] = [{ id: "general", name: "General", initialPath: "", taskIds: [] }];
  private connectedClients: Map<string, ServerWebSocket<WebSocketData>> = new Map();
  // Which tasks have ever reported a hook, and the timers waiting to find out
  // (§9, risk 4). Both in memory on purpose: what they guard is a running
  // PTY's output activity, which is per-process by definition. A task with no
  // live PTY has no heuristic to fall back to, so a flag that does not survive
  // a restart is not missing anything — and a resumed task genuinely is
  // unknown again until its agent reports in.
  private hookSeen: Set<string> = new Set();
  private hookGraceTimers: Map<string, Timer> = new Map();
  private hookGraceMs = 10_000;
  private startTimeoutMs = 4_000;
  // The resume in flight for a task, if any. Resuming is what a client does on
  // the way to opening a task, so two of them can easily overlap — and the
  // whole ladder is awaited, so the "is it already running?" check below is
  // separated from the spawn by several awaits. Without this, two concurrent
  // resumes both see no PTY and both start an agent on the same conversation
  // in the same directory, one of which is unreachable and never killed.
  private resuming: Map<string, Promise<TaskRow | undefined>> = new Map();
  // What `codetoaster hook` has to POST back to (§4.2), handed over by
  // startServer. Undefined until then: a manager with no server in front of it
  // — a test — has no port to name, and an agent spawned from one simply
  // reports nowhere.
  private port?: number;
  // And where it answers, when that is not loopback. A `--host` bind makes
  // `http://localhost:<port>` refuse the connection, so the reporter cannot
  // assemble its own URL from the port alone.
  private origin?: string;

  /** Takes the database to work against; defaults to the process-wide one.
   * Tasks and projects both come from it, so a caller cannot end up reading
   * one out of one database and the other out of another. */
  constructor(database?: Database) {
    this.database = database;
  }

  // Resolved on first use, not in the constructor: the module-level manager is
  // built at import time, and the database is only opened once the daemon
  // knows which file it is running against.
  private get db(): Database {
    return this.database ?? db.getDatabase();
  }

  private cachedStore?: TaskStore;
  private cachedStoreDb?: Database;
  private get store(): TaskStore {
    // Re-made when the handle underneath changes: initDatabase closes and
    // replaces the process-wide one, and a store pinned to the old handle
    // would fail every read against a closed database.
    const database = this.db;
    if (!this.cachedStore || this.cachedStoreDb !== database) {
      this.cachedStore = new TaskStore(database);
      this.cachedStoreDb = database;
    }
    return this.cachedStore;
  }

  // ---------------------------------------------------------------- startup

  /** The port the daemon ended up on, which every task's environment carries
   * so its hooks can reach us. Set once, at startup, before any task exists. */
  setPort(port: number, origin?: string): void {
    this.port = port;
    this.origin = origin;
  }

  /** How long a new task has to report its first hook before it is called
   * `unknown`. Long enough that a slow start is not mistaken for a hookless
   * one; short enough that a task never sits on `starting` for good. */
  setHookGrace(ms: number): void {
    this.hookGraceMs = ms;
  }

  /** How long a resume waits to see whether the agent came up before deciding
   * it did (§4.3). Only the cap — a hook or an exit settles it sooner. */
  setStartTimeout(ms: number): void {
    this.startTimeoutMs = ms;
  }

  loadProjects(): void {
    const rows = db.getAllProjects(this.db);
    this.projects = rows.map((row) => ({
      id: row.id,
      name: row.name,
      initialPath: row.initial_path,
      taskIds: [],
    }));
    // Ensure General always exists
    if (!this.projects.some((p) => p.id === "general")) {
      this.projects.unshift({ id: "general", name: "General", initialPath: "", taskIds: [] });
    }
  }

  /** Every `live` row is a lie at boot: closing the PTY masters took every
   * session shell and its children down with the daemon, so nothing survived
   * to be live (§5.5). Marking them suspended is the whole of what a restart
   * needs — the rows are still there to resume from. */
  reconcileOnBoot(): number {
    const stale = this.store.list({ lifecycle: "live" });
    for (const task of stale) {
      this.store.update(task.id, { lifecycle: "suspended", agent_state: "unknown" });
    }
    return stale.length;
  }

  // ----------------------------------------------------------------- clients

  registerClient(clientId: string, ws: ServerWebSocket<WebSocketData>): void {
    this.connectedClients.set(clientId, ws);
  }

  unregisterClient(clientId: string): void {
    this.connectedClients.delete(clientId);
  }

  broadcastToAll(message: object): void {
    const data = JSON.stringify(message);
    for (const ws of this.connectedClients.values()) {
      ws.send(data);
    }
  }

  /** The whole list, as one message. Shared with the `list` request so a
   * client that asks for the snapshot and one that is pushed it cannot drift. */
  tasksSnapshot(): ServerMessage {
    return { type: "tasks", list: this.listTasks(), projects: this.getProjects() };
  }

  /** The whole list — for a connect, or any change to which tasks exist. */
  broadcastTasks(): void {
    this.broadcastToAll(this.tasksSnapshot());
  }

  /** One row changed. Cheaper than a snapshot, and the reason the protocol has
   * both: an agent transitioning state must not re-send every task. */
  broadcastTask(taskId: string): void {
    const info = this.taskInfo(taskId);
    if (info) this.broadcastToAll({ type: "task", task: info });
  }

  // ------------------------------------------------------------------ tasks

  async createTask(options: CreateTaskOptions): Promise<TaskRow> {
    const { id } = options;
    if (this.store.get(id)) {
      throw new Error(`Task "${id}" already exists`);
    }

    // Inherit cwd from afterTaskId's terminal, or from the project's initialPath
    let cwd: string | undefined;
    if (options.afterTaskId) {
      // The live terminal first — it knows where the agent actually is — but a
      // task with no process still has a directory on its row, and inheriting
      // that beats silently falling back to the daemon's own cwd.
      cwd = (await this.primaryPty(options.afterTaskId)?.getCwd())
        ?? this.store.get(options.afterTaskId)?.cwd;
    }
    if (!cwd && options.projectId) {
      const project = this.projects.find((p) => p.id === options.projectId);
      if (project?.initialPath) cwd = expandTilde(project.initialPath);
    }
    // Spelled out rather than left undefined: the PTY inherits this directory
    // either way, but a derived title can only describe a cwd it knows.
    if (!cwd) cwd = process.cwd();

    // A caller-supplied title is a deliberate choice and outranks the terminal
    // title; otherwise the task gets the derived "<dir> · <branch>" label,
    // which any terminal title with real content will display over.
    // `||`, not `??`: an empty title is no title at all, and `title_source`
    // below judges it on truthiness — the two must not disagree, or a task
    // ends up labelled "" and recorded as having derived that.
    const title = options.title
      || uniqueName(await deriveTitle(cwd), this.taskTitles());

    const row = this.store.create({
      id,
      project_id: this.resolveProjectId(options),
      // Allocated here, before anything starts: passing `--session-id` is how
      // we know what to resume without asking the agent afterwards (§4.1).
      // A used id cannot be reused, so this is minted per task and only ever
      // replaced — by a `/clear` reported through SessionStart (TASK-11), or
      // by a start-fresh fallback (TASK-13).
      agent_session_id: crypto.randomUUID(),
      title,
      title_source: options.title ? "manual" : "derived",
      initial_prompt: options.prompt ?? "",
      // Resolved once and stored, so the data routes never have to ask a
      // process where they are (§5.4). `undefined` (the lookup never ran) is
      // recorded as "no repository" here, since there is no earlier value to
      // keep — refreshCwd is where the distinction matters.
      repo_root: (await resolveRepoRoot(cwd)) ?? null,
      cwd,
      model: options.model ?? null,
      permission_mode: options.permissionMode ?? null,
    });

    // The row is only worth keeping if something is running behind it: Bun.spawn
    // throws outright when the command is missing from PATH, and a row left
    // over from that is in no project, absent from every list, and blocks its
    // own id from ever being used again.
    // Before the spawn, because `--settings` names it: the agent reads the file
    // at startup, and a task whose hooks were written afterwards would run its
    // first session reporting nothing (§4.2). Skipped when the caller brought
    // its own command — a plain shell has no hooks to install.
    let settingsPath: string | undefined;
    if (!options.command) {
      try {
        settingsPath = await writeTaskSettings(id);
      } catch (e) {
        this.store.delete(id);
        // Bun.write creates the task directory before it writes the file, so a
        // failure part-way through leaves one behind exactly as a failed spawn
        // does — and with the row gone, nothing will ever read it again.
        fs.rmSync(taskDir(id), { recursive: true, force: true });
        throw e;
      }
    }

    let pty: Pty;
    try {
      pty = this.ptys.spawn(options.command ?? buildAgentCommand(row, { settingsPath }), {
        id: options.ptyId,
        cols: options.cols,
        rows: options.rows,
        cwd,
        // Every PTY of a task, not just the agent's: an extra shell tab
        // (TASK-27) wants the same task id to report under, and the same
        // scrub — a shell that ran `claude` by hand would otherwise hit the
        // inherited-marker problem the scrub exists for.
        env: taskEnv(process.env, { taskId: id, port: this.port, origin: this.origin }),
      });
    } catch (e) {
      this.store.delete(id);
      // The settings we just wrote go with the row. Nothing will ever read
      // that directory again — its task does not exist, and its id can never
      // be issued a second time — so leaving it behind leaks a directory per
      // failed create.
      if (settingsPath) fs.rmSync(taskDir(id), { recursive: true, force: true });
      throw e;
    }
    this.adopt(pty, id);
    this.armHookGrace(id);
    this.placeInProject(id, options);
    return row;
  }

  /** Wire a PTY to a task: the association, plus the callbacks that readdress
   * everything the PTY reports to the task that owns it. */
  private adopt(pty: Pty, taskId: string): void {
    this.ptyToTask.set(pty.id, taskId);
    let held = this.taskPtys.get(taskId);
    if (!held) {
      held = new Set();
      this.taskPtys.set(taskId, held);
    }
    held.add(pty.id);

    pty.onExit((code) => {
      // Only if this is still the task's terminal. A rung of the resume ladder
      // that did not work out is killed on the way to the next one, and its
      // exit callback lands afterwards — asynchronously, and therefore after
      // the successful rung has already written `starting`. Without this, a
      // task that resumed perfectly well on the second attempt advertises the
      // first attempt's death for the rest of its life.
      if (this.ptyToTask.get(pty.id) !== taskId) return;
      this.store.update(taskId, { agent_state: "exited", exit_code: code });
      this.broadcastTask(taskId);
    });
    // The terminal title is part of every task's info, and clients project it
    // over the stored title at render time — so a change only has to be sent.
    pty.onTitleChange(() => {
      this.broadcastTask(taskId);
    });
    pty.onActivityChange((_ptyId, active) => {
      // Recency is what the task list is ordered by, so it is worth a write —
      // but not a row broadcast, which is what the activity message is for.
      if (active) this.store.update(taskId, { last_active_at: Date.now() });
      // Degraded mode (§9, risk 4). An agent run with hooks disabled, or one
      // whose payloads a future version has changed, reports nothing — and a
      // task list that says `starting` forever is worse than v1's guess. So
      // for a task that has never reported a hook, output activity stands in
      // for busy/idle, exactly as v1 inferred it. The moment any hook arrives
      // this goes back to being about recency alone, and never fights the
      // agent's own account of itself.
      if (!this.hookSeen.has(taskId)) this.inferState(taskId, active);
      this.broadcastToAll({ type: "activity", taskId, active });
    });
    pty.onNotification((_ptyId, title, body) => {
      this.broadcastToAll({ type: "notification", taskId, title, body });
      this.broadcastTask(taskId);
    });
  }

  /** The heuristic's answer, for a task that has no better one. Confined to
   * the states the heuristic is entitled to speak about: a task that has
   * exited, or that is waiting on the user, is not idle just because its
   * terminal went quiet. */
  private inferState(taskId: string, active: boolean): void {
    const current = this.store.get(taskId)?.agent_state;
    if (current !== "starting" && current !== "unknown" && current !== "busy" && current !== "idle") {
      return;
    }
    const next = active ? "busy" : "idle";
    if (current === next) return;
    this.store.update(taskId, { agent_state: next });
    this.broadcastTask(taskId);
  }

  /** Start the clock on a task's first hook. If none arrives, the task stops
   * claiming to be `starting` and admits it does not know. */
  private armHookGrace(taskId: string): void {
    this.disarmHookGrace(taskId);
    const timer = setTimeout(() => {
      this.hookGraceTimers.delete(taskId);
      if (this.hookSeen.has(taskId)) return;
      // Only from `starting`. If output activity has already said busy or
      // idle, that is a better answer than `unknown` and replacing it would
      // be a downgrade.
      if (this.store.get(taskId)?.agent_state !== "starting") return;
      this.store.update(taskId, { agent_state: "unknown" });
      this.broadcastTask(taskId);
    }, this.hookGraceMs);
    // Nothing should be held open waiting to relabel a task.
    timer.unref?.();
    this.hookGraceTimers.set(taskId, timer);
  }

  private disarmHookGrace(taskId: string): void {
    const timer = this.hookGraceTimers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.hookGraceTimers.delete(taskId);
    }
  }

  // ----------------------------------------------------------------- resume

  /** Spawn an agent for a task that already has a row, wire it up, and start
   * its hook clock. Shared by the create path and every rung of the resume
   * ladder, so a resumed agent gets the same settings file, the same scrubbed
   * environment and the same task-id plumbing as a fresh one. */
  private async spawnAgent(
    row: TaskRow,
    options: { mode: AgentMode; sessionId?: string; cols?: number; rows?: number },
  ): Promise<Pty> {
    // The question both users of this flag ask is "has the agent that is
    // running now reported?", not "has anything ever reported for this task".
    // A task resumed inside a daemon that already saw its hooks would
    // otherwise start out as if the new process had already checked in:
    // awaitAgentStart would return true before the process had drawn a
    // character, and the very first rung of the ladder would be declared a
    // success however dead it was.
    this.hookSeen.delete(row.id);
    const settingsPath = await writeTaskSettings(row.id);
    const pty = this.ptys.spawn(
      buildAgentCommand(row, { mode: options.mode, sessionId: options.sessionId, settingsPath }),
      {
        cols: options.cols,
        rows: options.rows,
        cwd: row.cwd,
        env: taskEnv(process.env, { taskId: row.id, port: this.port, origin: this.origin }),
      },
    );
    this.adopt(pty, row.id);
    this.armHookGrace(row.id);
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
   * working terminal because it was quiet would be the worse mistake. */
  private awaitAgentStart(taskId: string, pty: Pty): Promise<boolean> {
    const capMs = this.startTimeoutMs;
    if (this.hookSeen.has(taskId)) return Promise.resolve(true);
    return new Promise((resolve) => {
      const finish = (started: boolean) => {
        clearInterval(poll);
        clearTimeout(cap);
        resolve(started);
      };
      const poll = setInterval(() => {
        if (this.hookSeen.has(taskId)) finish(true);
        else if (pty.exited) finish(false);
      }, 25);
      const cap = setTimeout(() => finish(true), capMs);
    });
  }

  /** Take back a PTY that did not work out, so the next rung starts clean. */
  private discardPty(pty: Pty, taskId: string): void {
    this.ptys.kill(pty.id);
    this.ptyToTask.delete(pty.id);
    this.taskPtys.get(taskId)?.delete(pty.id);
    this.hookSeen.delete(taskId);
    this.disarmHookGrace(taskId);
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
    const row = this.store.get(taskId);
    if (!row) return undefined;
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
    const existing = this.primaryPty(taskId);
    if (existing && !existing.exited) return row;
    // Nothing is going to attach to a dead terminal again, and leaving it
    // associated would have the new agent's task still pointing at it.
    if (existing) this.discardPty(existing, taskId);
    // …including twice at once. The ladder is awaited end to end, so a second
    // caller arriving mid-flight would otherwise pass the check above and
    // start a second agent; it joins the first one's answer instead.
    const inFlight = this.resuming.get(taskId);
    if (inFlight) return inFlight;

    const attempt = this.runResumeLadder(taskId, row, options).finally(() => {
      this.resuming.delete(taskId);
    });
    this.resuming.set(taskId, attempt);
    return attempt;
  }

  private async runResumeLadder(
    taskId: string,
    initial: TaskRow,
    options: { fresh?: boolean; cols?: number; rows?: number },
  ): Promise<TaskRow | undefined> {
    let row = initial;
    const size = {
      // The grid the task had when it was suspended, so its output does not
      // reflow on the way back (§5.3).
      cols: options.cols ?? row.last_size_cols ?? DEFAULT_SIZE.cols,
      rows: options.rows ?? row.last_size_rows ?? DEFAULT_SIZE.rows,
    };

    for (const attempt of this.resumeLadder(row, options.fresh === true)) {
      if (attempt.mint) {
        // A used id cannot be reused — `--session-id` on one that already has
        // a transcript fails with "already in use", so starting fresh on the
        // stored id would fail a second time and strand the task in a retry
        // loop (§4.3). The new id goes on the row before the spawn, so a
        // crash between the two leaves something resumable rather than a row
        // pointing at a conversation that was never opened.
        this.store.update(taskId, { agent_session_id: crypto.randomUUID() });
        row = this.store.get(taskId)!;
      }

      // The row is carrying the last process's verdict on itself: `exited`
      // with an exit code from the agent that went away, `could_not_resume`
      // from a resume that already failed, or `exited` from the rung before
      // this one. None of those survive a spawn, and none of them are states
      // anything else revisits — `inferState` only speaks about
      // starting/unknown/busy/idle, and the hook grace timer only downgrades
      // `starting`. Left alone, a resumed task whose agent reports no hooks
      // would read as dead for the rest of its life.
      row = this.store.update(taskId, { agent_state: "starting", exit_code: null }) ?? row;

      let pty: Pty;
      try {
        pty = await this.spawnAgent(row, { ...attempt, ...size });
      } catch {
        // The binary is missing or unrunnable: no rung will do better.
        break;
      }

      if (await this.awaitAgentStart(taskId, pty)) {
        this.store.update(taskId, { lifecycle: "live", last_active_at: Date.now() });
        // The in-memory grouping only ever held the tasks *this* run created,
        // and a task worth resuming is by definition one it did not. Without
        // this the task is live and has a terminal, but `listTasks` — which
        // walks projects, not rows — cannot see it, so the very next
        // `broadcastTasks` sends every client a snapshot with the task they
        // just resumed missing from it.
        this.ensureInProject(taskId);
        this.broadcastTask(taskId);
        return this.store.get(taskId);
      }
      this.discardPty(pty, taskId);
    }

    // Nothing worked. The task is not a dead terminal and not a lie about
    // being live — it is a card with a button on it (§4.3).
    this.store.update(taskId, { agent_state: "could_not_resume" });
    this.broadcastTask(taskId);
    return this.store.get(taskId);
  }

  /** The rungs to try, in order (§4.3). A fresh start is not a rung — it is
   * the user choosing to stop trying. */
  private resumeLadder(
    row: TaskRow,
    fresh: boolean,
  ): Array<{ mode: AgentMode; sessionId?: string; mint?: boolean }> {
    if (fresh) return [{ mode: "start", mint: true }];

    const ladder: Array<{ mode: AgentMode; sessionId?: string; mint?: boolean }> = [];
    // Offered only when a transcript for that id is actually there. This has
    // to be decided up front rather than discovered: a `--resume` on an id
    // with no conversation exits 1 down a pipe, but in a PTY it prints the
    // error and keeps running, so a doomed rung is indistinguishable from a
    // healthy one once it has started.
    if (row.agent_session_id && canResumeSessionId(row, row.agent_session_id)) {
      ladder.push({ mode: "resume", sessionId: row.agent_session_id });
    }
    // The conversation the task itself last reported, when that is not the one
    // the row names. The row's id can go stale — a `/clear` we missed, a
    // hand-edited database — while `transcript_path` came from the agent's own
    // SessionStart and names its file directly. Resuming by id from that
    // filename is both precise and cheap, and it is the rung that recovers a
    // task whose stored id no longer means anything.
    const reported = sessionIdFromTranscript(row.transcript_path);
    if (reported && reported !== row.agent_session_id && transcriptExists(row.transcript_path)) {
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
    const continueSafe = continueIsSafe(row);
    if (continueSafe) ladder.push({ mode: "continue" });
    // Last: a conversation we have never been told about, found by looking.
    // Whatever opens reports its own SessionStart, and the row picks the id up
    // from the hook — so a successful rung here heals what sent us down it.
    //
    // NOTE (review): this rung and `continueIsSafe` above disagree. When the
    // newest transcript in the directory is not the one this task reported,
    // `--continue` is refused precisely because it would open a stranger's
    // conversation — and then the scan below picks that same newest file and
    // resumes it by id instead, which is the same mistake with more steps.
    // Left as it is because closing it is a judgement call, not a typo: gating
    // the scan on `continueIsSafe` would disable the rung in exactly the case
    // it was added for (a stale `agent_session_id` healed from a newer
    // transcript), and the ambiguity only really goes away with
    // worktree-per-task (m-4), where a directory holds one conversation.
    // Gated on the same judgement as `--continue`, and for the same reason:
    // without it the guard above is theatre. Refusing `--continue` because the
    // newest conversation in the directory is a stranger's, and then resuming
    // that very file by id one rung later, is worse than not checking at all.
    //
    // What this costs is the rung §4.3 wanted for a pruned or skewed
    // transcript — but only in a directory we can see is shared, which is
    // exactly where guessing picks up somebody else's conversation. In a
    // worktree (m-4) the directory holds one conversation, the guard passes,
    // and the rung comes back.
    const found = continueSafe
      ? findResumableTranscript(row, { notThis: row.agent_session_id })
      : undefined;
    if (found && !ladder.some((rung) => rung.sessionId === found.sessionId)) {
      ladder.push({ mode: "resume", sessionId: found.sessionId });
    }
    return ladder;
  }

  /** Apply one hook payload to a task (§4.2). False when there is no such
   * task or the payload moves nothing — both of which the caller answers 2xx,
   * since a hook that reports a problem reports it into the agent's own
   * transcript. */
  applyHook(taskId: string, payload: HookPayload): boolean {
    if (!this.store.get(taskId)) return false;
    // Recorded before the mapping runs, and for any payload at all: what this
    // says is "the hooks are wired up", which a payload we do not map answers
    // just as well as one we do. From here the heuristic stays out of the way.
    this.hookSeen.add(taskId);
    this.disarmHookGrace(taskId);
    const update = transitionFor(payload);
    if (!update) return false;
    if (!this.store.update(taskId, update)) return false;
    this.broadcastTask(taskId);
    return true;
  }

  getTask(taskId: string): TaskRow | undefined {
    return this.store.get(taskId);
  }

  taskIdForPty(ptyId: string): string | undefined {
    return this.ptyToTask.get(ptyId);
  }

  /** The terminal a task's tabs open onto. One for now; TASK-27 adds more. */
  primaryPty(taskId: string): Pty | undefined {
    for (const ptyId of this.taskPtys.get(taskId) ?? []) {
      const pty = this.ptys.get(ptyId);
      if (pty) return pty;
    }
    return undefined;
  }

  /** A live PTY by id, for the routes that serialize or write to one. */
  getPty(ptyId: string): Pty | undefined {
    return this.ptys.get(ptyId);
  }

  /** The one thing a live PTY is still better at than the row: noticing the
   * agent has cd'd somewhere unexpected (§5.4). Opportunistic — callers ask
   * when they happen to be listing tasks anyway, and a suspended task simply
   * has nothing to report. Re-resolves repo_root when the directory moved, or
   * when the row is still carrying a null root, since that is a git call. */
  async refreshCwd(taskId: string): Promise<string | undefined> {
    const task = this.store.get(taskId);
    if (!task) return undefined;
    const live = await this.primaryPty(taskId)?.getCwd();
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
    this.store.update(taskId, {
      ...(moved ? { cwd: live } : {}),
      ...(repoRoot === undefined ? {} : { repo_root: repoRoot }),
    });
    this.broadcastTask(taskId);
    return live ?? task.cwd;
  }

  renameTask(taskId: string, title: string): boolean {
    // An explicit rename opts the task out of derivation for good.
    if (!this.store.update(taskId, { title, title_source: "manual" })) return false;
    this.broadcastTask(taskId);
    return true;
  }

  /** v1's "close the session": the task and its terminals go away for good.
   * §6 makes closing a suspend instead, with archive as the destructive one —
   * that lands with TASK-16 and TASK-31.
   *
   * It deliberately leaves `~/.codetoaster/tasks/<id>/` behind, and that is a
   * leak for as long as close means delete: the row is gone, so the id can
   * never be reissued, so nothing will ever read that directory again — and
   * TASK-14 will be putting scrollback snapshots in it beside the settings.
   * Deleting it here would be the wrong fix, because TASK-16 turns close into
   * a suspend, and a suspended task's directory is exactly what reopening it
   * reads. The removal belongs to archive (TASK-31), which is the operation
   * that actually ends a task. Until then a closed task costs a few KB of
   * JSON. */
  closeTask(taskId: string): boolean {
    if (!this.store.get(taskId)) return false;
    // Before the row goes: a timer that outlived its task would wake up to
    // relabel something that is no longer there.
    this.disarmHookGrace(taskId);
    this.hookSeen.delete(taskId);
    for (const ptyId of [...(this.taskPtys.get(taskId) ?? [])]) {
      this.ptys.kill(ptyId);
      this.ptyToTask.delete(ptyId);
    }
    this.taskPtys.delete(taskId);
    this.store.delete(taskId);
    for (const project of this.projects) {
      const idx = project.taskIds.indexOf(taskId);
      if (idx !== -1) {
        project.taskIds.splice(idx, 1);
        break;
      }
    }
    return true;
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
    if (acknowledged) this.broadcastTask(taskId);
  }

  // ------------------------------------------------------------- attachment

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
    ws.send(JSON.stringify({ type: "attached", ptyId, taskId: taskId ?? ptyId }));

    // Opening a task's terminal is the moment before its Changes, Files and
    // History tabs get used, and it is the only such moment the browser
    // reaches — GET /api/tasks is CLI-only. Without this, a task created in a
    // directory the agent then cd'd out of would keep answering those tabs
    // from the root it had at creation, or 400 them forever if it had none.
    // Fire-and-forget: it broadcasts a delta if anything moved, and a failure
    // to notice is not a reason to refuse the attach.
    if (taskId) void this.refreshCwd(taskId).catch(() => {});

    return this.ptys.attach(ptyId, clientId, ws, cols, rows);
  }

  /** Detach one terminal, or every one the client holds when omitted (the
   * socket closed). */
  detachClient(clientId: string, ptyId?: string): void {
    this.ptys.detach(clientId, ptyId);
  }

  /** False when the client is not attached to the terminal it named —
   * attachment is the authorization, so the caller can report it rather than
   * dropping the keystroke silently. */
  writeToPty(clientId: string, ptyId: string, data: string): boolean {
    return this.ptys.write(clientId, ptyId, data);
  }

  /** False on the same unattached-client check as writeToPty. A stale resize
   * is not worth an error reply — a client that just detached will re-measure
   * on its next attach — but the answer is the layer below's to give, not this
   * one's to swallow. */
  resizePty(clientId: string, ptyId: string, cols: number | null, rows: number | null): boolean {
    return this.ptys.resize(clientId, ptyId, cols, rows);
  }

  getClientPtyIds(clientId: string): string[] {
    return this.ptys.clientPtyIds(clientId);
  }

  getConnections(): Array<{ clientId: string; ptyIds: string[] }> {
    return [...this.connectedClients.keys()].map((clientId) => ({
      clientId,
      ptyIds: this.getClientPtyIds(clientId),
    }));
  }

  // -------------------------------------------------------------- rendering

  taskInfo(taskId: string): TaskInfo | undefined {
    const row = this.store.get(taskId);
    if (!row) return undefined;
    const pty = this.primaryPty(taskId);
    return {
      id: row.id,
      ptyId: pty?.id ?? null,
      title: row.title,
      titleSource: row.title_source,
      terminalTitle: pty?.title ?? "",
      agentState: row.agent_state,
      lifecycle: row.lifecycle,
      clientCount: pty?.getClientCount() ?? 0,
      // A suspended task remembers the grid it had, so resuming it does not
      // reflow the agent's output (§5.3).
      size: pty?.getSize() ?? {
        cols: row.last_size_cols ?? DEFAULT_SIZE.cols,
        rows: row.last_size_rows ?? DEFAULT_SIZE.rows,
      },
      createdAt: row.created_at,
      lastActiveAt: row.last_active_at,
      exited: pty?.exited ?? false,
      hasNotification: pty?.hasNotification ?? false,
    };
  }

  /** In project order, live only. The v1 sidebar has no way to render a
   * suspended task, and widening this is TASK-25's job along with the recency
   * list that replaces the grouping. */
  listTasks(): TaskInfo[] {
    const result: TaskInfo[] = [];
    for (const project of this.projects) {
      for (const taskId of project.taskIds) {
        const info = this.taskInfo(taskId);
        if (info && info.lifecycle === "live") result.push(info);
      }
    }
    return result;
  }

  private taskTitles(): string[] {
    return this.listTasks().map((task) => task.title);
  }

  // --------------------------------------------------------------- projects

  hasProject(projectId: string): boolean {
    return this.projects.some((p) => p.id === projectId);
  }

  getProjects(): ProjectInfo[] {
    return this.projects.map((p) => ({ ...p, taskIds: [...p.taskIds] }));
  }

  private resolveProjectId(options: CreateTaskOptions): string {
    if (options.afterTaskId) {
      const after = this.projects.find((p) => p.taskIds.includes(options.afterTaskId!));
      if (after && (!options.projectId || options.projectId === after.id)) return after.id;
    }
    if (options.projectId && this.projects.some((p) => p.id === options.projectId)) {
      return options.projectId;
    }
    return "general";
  }

  /** Put a task into the sidebar grouping if it is not there already, by the
   * project its row names. What a task created by a previous daemon needs
   * before it can appear in `listTasks` at all — `loadProjects` starts every
   * project empty, since the ordering is the only thing the rows do not
   * record. */
  private ensureInProject(taskId: string): void {
    if (this.projects.some((p) => p.taskIds.includes(taskId))) return;
    const projectId = this.store.get(taskId)?.project_id;
    const project =
      this.projects.find((p) => p.id === projectId) ??
      this.projects.find((p) => p.id === "general");
    project?.taskIds.push(taskId);
  }

  private placeInProject(taskId: string, options: CreateTaskOptions): void {
    const project = this.projects.find((p) => p.id === this.resolveProjectId(options))!;
    const afterIndex = options.afterTaskId ? project.taskIds.indexOf(options.afterTaskId) : -1;
    if (afterIndex >= 0) {
      project.taskIds.splice(afterIndex + 1, 0, taskId);
    } else {
      project.taskIds.push(taskId);
    }
  }

  createProject(id: string, name: string, initialPath: string): void {
    if (this.projects.some((p) => p.id === id)) {
      throw new Error(`Project "${id}" already exists`);
    }
    db.createProject({ id, name, initial_path: initialPath, sort_order: this.projects.length }, this.db);
    this.projects.push({ id, name, initialPath, taskIds: [] });
    this.broadcastTasks();
  }

  updateProject(id: string, name: string, initialPath: string): boolean {
    const project = this.projects.find((p) => p.id === id);
    if (!project) return false;
    db.updateProject(id, { name, initial_path: initialPath }, this.db);
    project.name = name;
    project.initialPath = initialPath;
    this.broadcastTasks();
    return true;
  }

  deleteProject(id: string): boolean {
    if (id === "general") return false;
    const index = this.projects.findIndex((p) => p.id === id);
    if (index === -1) return false;
    const project = this.projects[index]!;
    const general = this.projects.find((p) => p.id === "general")!;
    // The tasks outlive the grouping: they move to General rather than being
    // destroyed with it. By column, not by `project.taskIds` — that list only
    // holds the tasks this run started, so a task suspended by a previous
    // daemon would keep a project_id pointing at a project that no longer
    // exists, and nothing else ever revisits the column.
    this.store.reassignProject(id, "general");
    general.taskIds.push(...project.taskIds);
    this.projects.splice(index, 1);
    db.deleteProject(id, this.db);
    this.broadcastTasks();
    return true;
  }

  reorderProjects(orderedProjects: Array<{ id: string; taskIds: string[] }>): void {
    const validTaskIds = new Set(this.projects.flatMap((p) => p.taskIds));
    const existing = new Map(this.projects.map((p) => [p.id, p]));
    const seenProjects = new Set<string>();
    const seenTasks = new Set<string>();
    const next: ProjectInfo[] = [];

    for (const { id, taskIds } of orderedProjects) {
      const project = existing.get(id);
      if (!project || seenProjects.has(id)) continue;
      seenProjects.add(id);

      const kept: string[] = [];
      for (const taskId of taskIds) {
        if (validTaskIds.has(taskId) && !seenTasks.has(taskId)) {
          kept.push(taskId);
          seenTasks.add(taskId);
        }
      }
      next.push({ ...project, taskIds: kept });
    }

    // Append projects the client did not mention, keeping whatever they held.
    for (const project of this.projects) {
      if (seenProjects.has(project.id)) continue;
      const kept = project.taskIds.filter((id) => validTaskIds.has(id) && !seenTasks.has(id));
      for (const id of kept) seenTasks.add(id);
      next.push({ ...project, taskIds: kept });
      seenProjects.add(project.id);
    }

    // Anything the reorder dropped on the floor lands in General rather than
    // vanishing from the sidebar while its process keeps running.
    const general = next.find((p) => p.id === "general")!;
    for (const taskId of validTaskIds) {
      if (!seenTasks.has(taskId)) general.taskIds.push(taskId);
    }

    this.projects = next;
    // The in-memory order is the v1 sidebar's, but which project a task
    // belongs to is durable — so rows that actually moved get written, and
    // the ones that only shifted position do not.
    for (const project of next) {
      for (const taskId of project.taskIds) {
        if (this.store.get(taskId)?.project_id !== project.id) {
          this.store.update(taskId, { project_id: project.id });
        }
      }
    }
    db.updateProjectOrder(next.map((p, i) => ({ id: p.id, sort_order: i })), this.db);
    this.broadcastTasks();
  }
}

export const taskManager = new TaskManager();
