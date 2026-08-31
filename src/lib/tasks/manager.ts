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
import { deriveTitle, resolveRepoRoot, titleFromPrompt } from "./derive";
import { removeSnapshot, writeSnapshot } from "./snapshot";

function expandTilde(filepath: string): string {
  if (filepath.startsWith("~/") || filepath === "~") {
    return os.homedir() + filepath.slice(1);
  }
  return filepath;
}

const DEFAULT_SIZE = { cols: 80, rows: 24 };

/** The project every task without one falls into. Minted per call rather than
 * shared: the caller pushes it into a list whose `taskIds` it then mutates. */
function generalProject(): ProjectInfo {
  return {
    id: "general",
    name: "General",
    initialPath: "",
    taskIds: [],
    defaultModel: null,
    defaultPermissionMode: null,
  };
}

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
  // Which of a task's terminals is the agent's (§3). Held apart from the set
  // above rather than inferred from it, because the set is unordered in every
  // way that matters: `resumeTask` on a *live* task — an agent that exited, or
  // a `fresh: true` — discards the old agent and adopts the new one after
  // whatever shell tabs are open, so "the first live PTY the task holds" would
  // answer with a shell. Everything that means *the agent* reads through here:
  // `taskInfo.ptyId` (what a client attaches its agent tab to), `snapshot`,
  // `refreshCwd`, and resume's own already-running test.
  private agentPtys: Map<string, string> = new Map();
  private projects: ProjectInfo[] = [generalProject()];
  private connectedClients: Map<string, ServerWebSocket<WebSocketData>> = new Map();
  // Which tasks have ever reported a hook, and the timers waiting to find out
  // (§9, risk 4). Both in memory on purpose: what they guard is a running
  // PTY's output activity, which is per-process by definition. A task with no
  // live PTY has no heuristic to fall back to, so a flag that does not survive
  // a restart is not missing anything — and a resumed task genuinely is
  // unknown again until its agent reports in.
  private hookSeen: Set<string> = new Set();
  private hookGraceTimers: Map<string, Timer> = new Map();
  // When each task's directory was last checked against its live terminal.
  // The data routes ask on every request; this is what keeps that from being a
  // process spawn every time (TASK-41).
  private cwdCheckedAt: Map<string, number> = new Map();
  private cwdRefreshWindowMs = 3_000;
  private hookGraceMs = 10_000;
  private startTimeoutMs = 4_000;
  // The resume in flight for a task, if any. Resuming is what a client does on
  // the way to opening a task, so two of them can easily overlap — and the
  // whole ladder is awaited, so the "is it already running?" check below is
  // separated from the spawn by several awaits. Without this, two concurrent
  // resumes both see no PTY and both start an agent on the same conversation
  // in the same directory, one of which is unreachable and never killed.
  private resuming: Map<string, Promise<TaskRow | undefined>> = new Map();
  // The mirror of `resuming`, and it has to exist for the same reason. Suspend
  // is not synchronous either: it awaits `snapshot`, which is a multi-hundred-KB
  // screen written to disk, and only *after* that does it kill the task's PTYs
  // and write `suspended`. A resume arriving inside that window saw a live,
  // unexited PTY and answered 200 with the ptyId of a terminal about to be
  // killed — or, where the agent had already exited, spawned a fresh one that
  // the suspend then killed along with the rest, leaving the user's close
  // silently undone by the ladder walking on.
  //
  // Each side registers its entry only *after* waiting on the other's, so the
  // two can never wait on each other — and each starts over once that wait is
  // done rather than carrying on, since the promise it waited on may have
  // handed straight to another one of the other kind.
  private suspending: Map<string, Promise<boolean>> = new Map();
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

  /** How long a task's directory is trusted before the terminal is asked
   * again. Zero asks every time, which is what a test wants and what nothing
   * else does. */
  setCwdRefreshWindow(ms: number): void {
    this.cwdRefreshWindowMs = ms;
  }

  loadProjects(): void {
    const rows = db.getAllProjects(this.db);
    this.projects = rows.map((row) => ({
      id: row.id,
      name: row.name,
      initialPath: row.initial_path,
      taskIds: [],
      defaultModel: row.default_model,
      defaultPermissionMode: row.default_permission_mode,
    }));
    // Ensure General always exists
    if (!this.projects.some((p) => p.id === "general")) {
      this.projects.unshift(generalProject());
    }
  }

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
    const stale = this.store.list({ lifecycle: "live" });
    for (const task of stale) {
      this.store.update(task.id, { lifecycle: "suspended", agent_state: "unknown" });
    }
    for (const task of this.store.list({ lifecycle: ["live", "suspended"] }).reverse()) {
      this.ensureInProject(task.id);
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
      const named = this.projects.find((p) => p.id === options.projectId);
      if (named?.initialPath) cwd = expandTilde(named.initialPath);
    }
    // Spelled out rather than left undefined: the PTY inherits this directory
    // either way, but a derived title can only describe a cwd it knows.
    if (!cwd) cwd = process.cwd();

    // Three sources, in order of how much they know about what this task is
    // *for* (§7.5). A caller-supplied title is a deliberate choice and outranks
    // everything, including the terminal title, for good. Failing that the
    // opening line of the prompt, which is nearly always the ask — and which is
    // the whole reason a list of thirty tasks in one checkout is readable.
    // Failing that the "<dir> · <branch>" label, which at least says where.
    //
    // Only the first is `manual`. The other two are guesses, and a live
    // terminal title — the agent's own account of what it is doing — is
    // allowed to display over either (naming.ts).
    //
    // `||`, not `??`: an empty title is no title at all, and `title_source`
    // below judges it on truthiness — the two must not disagree, or a task
    // ends up labelled "" and recorded as having derived that.
    //
    // One expression, so each `||` still short-circuits the one after it:
    // `deriveTitle` shells out to git (two calls on a detached HEAD, 2s of
    // timeout budget), and a create that already knows its title — or can read
    // one off the prompt — must not block on a lookup whose answer it throws
    // away. Hoisting the derived label to its own `const` is what would cost
    // that.
    const title = options.title
      || uniqueName(titleFromPrompt(options.prompt) || (await deriveTitle(cwd)), this.taskTitles());

    // Resolved once and reused below, rather than asked again after the
    // settings write and the spawn. `resolveProjectId` keys off `afterTaskId`
    // still being in some project's `taskIds`, and `deleteTask` splices ids out
    // of that list — so a task deleted while this create is awaiting would have
    // the row say one project and the sidebar say General.
    const projectId = this.resolveProjectId(options);
    const project = this.projects.find((p) => p.id === projectId);

    const row = this.store.create({
      id,
      project_id: projectId,
      // Allocated here, before anything starts: passing `--session-id` is how
      // we know what to resume without asking the agent afterwards (§4.1).
      // A used id cannot be reused, so this is minted per task and only ever
      // replaced — by a `/clear` reported through SessionStart (TASK-11), or
      // by a start-fresh fallback (TASK-13).
      agent_session_id: crypto.randomUUID(),
      title,
      title_source: options.title ? "manual" : "derived",
      // Trimmed, because `buildAgentCommand` judges this on truthiness and
      // `titleFromPrompt` above judges it on having a non-blank line: the two
      // must agree, or a whitespace-only prompt gets the directory label as
      // though it said nothing while still travelling in argv to submit a blank
      // opening turn. `POST /api/tasks` refuses a blank prompt outright, so
      // this is what keeps the invariant true for a caller reaching the manager
      // directly rather than a second line of defence against the route.
      initial_prompt: options.prompt?.trim() ?? "",
      // Resolved once and stored, so the data routes never have to ask a
      // process where they are (§5.4). `undefined` (the lookup never ran) is
      // recorded as "no repository" here, since there is no earlier value to
      // keep — refreshCwd is where the distinction matters.
      repo_root: (await resolveRepoRoot(cwd)) ?? null,
      cwd,
      // The project's column is what an absent option means. The composer
      // sends only what the user actually overrode — "Project default" is no
      // field at all — so resolving here rather than in the client is what
      // gives the API and the CLI the same answer for free.
      //
      // Read off `projectId`, the project the task actually joins, and not off
      // `options.projectId`, the one the caller happened to name. A create that
      // names no project still lands in "general", so keying this off the
      // option meant `POST /api/tasks {prompt}` — the API and CLI shape, the
      // very callers this is resolved server-side for — inherited nothing at
      // all while the row sat in a project with defaults set.
      model: options.model ?? project?.defaultModel ?? null,
      permission_mode: options.permissionMode ?? project?.defaultPermissionMode ?? null,
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
    this.placeInProject(id, projectId, options);
    return row;
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
  private adopt(pty: Pty, taskId: string, agent = true): void {
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

  /**
   * The much smaller half of `adopt`: what a shell tab is allowed to report.
   *
   * A shell is a process in the task's directory, not a voice for the task. So
   * it moves the task up the recency list — a user running a build in a shell
   * tab is working on that task, and a list ordered by recency that says
   * otherwise is wrong — and it tells clients when it dies, because a tab bound
   * to a PTY that is gone has to stop being drawn (§5.5, and `pruneShellTabs`).
   * It does not touch `agent_state`, does not become the task's
   * `terminalTitle`, does not feed the degraded-mode inference, and raises no
   * notifications: those are all claims about the conversation.
   *
   * No `activity` message either, for a reason worth stating: activity is
   * addressed to the *task*, and the sidebar's dot is edge-triggered off it. A
   * shell and an agent both emitting would have each one's falling edge clear
   * the other's dot, so a build finishing would put out the light on an agent
   * still mid-turn.
   */
  private adoptShell(pty: Pty, taskId: string): void {
    pty.onExit(() => {
      // Only if the task still holds it: `discardPty` and `doSuspend` both kill
      // shells on their way past, and an exit callback landing after the task
      // has been deleted would broadcast a row that is no longer there.
      if (this.ptyToTask.get(pty.id) !== taskId) return;
      this.broadcastTask(taskId);
    });
    pty.onActivityChange((_ptyId, active) => {
      if (active) this.store.update(taskId, { last_active_at: Date.now() });
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
    // `idle_since` is stamped here too, and not only by the hook path: it is
    // what the idle harvester counts from (TASK-15), and nothing else writes
    // it for a task running in degraded mode. Left alone, an agent that
    // reports no hooks inherits whatever the column held from its previous
    // life — a `Stop` from hours ago, or the value a restart left behind — so
    // the first time output activity infers `idle` the task is already past
    // `harvest_after` and is suspended out from under a user who has only just
    // reopened it. Same restamp, and the same reason, as the `/clear` and
    // resume case in `transitionFor`.
    this.store.update(taskId, {
      agent_state: next,
      ...(next === "idle" ? { idle_since: Date.now() } : {}),
    });
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
    //
    // Cleared on the far side of the settings write, not before it. `codetoaster
    // hook` is a separate process that `Bun.spawn().kill()` does not signal, so
    // a hook POSTed by the rung the ladder just discarded can land during that
    // await — and a flag set then would make `awaitAgentStart` return true
    // instantly for the *next* rung, declaring it a success however dead it is.
    const settingsPath = await writeTaskSettings(row.id);
    this.hookSeen.delete(row.id);
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
      // `!pty.exited`, not a bare `true`: the cap means "quiet, but still up",
      // and a process that has already died is neither. The poll would catch it
      // 25ms later anyway — this only stops the timer winning that race and
      // declaring a corpse a working agent.
      const cap = setTimeout(() => finish(!pty.exited), capMs);
    });
  }

  /** Take back a PTY that did not work out, so the next rung starts clean. */
  private discardPty(pty: Pty, taskId: string): void {
    this.ptys.kill(pty.id);
    this.ptyToTask.delete(pty.id);
    this.taskPtys.get(taskId)?.delete(pty.id);
    // Only if it was the one: this is reached with the agent's terminal, and
    // clearing the slot unconditionally would be right today and wrong the
    // moment anything discards a shell through here.
    if (this.agentPtys.get(taskId) === pty.id) this.agentPtys.delete(taskId);
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
    // A close already in flight settles first, and then this starts over
    // against the row it left. Suspend awaits a snapshot write before it kills
    // anything, so without this the checks below inspect a task whose PTYs are
    // moments from being killed: the "already running" arm hands back a ptyId
    // the close is about to kill, and the ladder arm spawns an agent the close
    // then kills along with the rest — undoing the user's close, or leaving
    // them attached to a corpse. Waiting means the resume is judged against the
    // task the close produced, which is the task as it now is.
    const suspendInFlight = this.suspending.get(taskId);
    if (suspendInFlight) {
      await suspendInFlight.catch(() => undefined);
      return this.resumeTask(taskId, options);
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
    const alreadyResuming = this.resuming.get(taskId);
    if (alreadyResuming) {
      if (options.fresh !== true) return alreadyResuming;
      await alreadyResuming.catch(() => undefined);
      return this.resumeTask(taskId, options);
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
    const existing = this.primaryPty(taskId);
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
      // The task can be closed while the ladder is running: it awaits a spawn
      // and up to `startTimeoutMs` per rung, and deleteTask is one synchronous
      // DELETE away. Everything below assumes the row is still there — the
      // mint rung dereferences it outright, and the success arm hands the PTY
      // to `adopt`, which would re-register a terminal under a task that no
      // longer exists. Nothing kills that PTY afterwards (deleteTask already
      // walked the list it is being added back to) and nothing ever shows it,
      // so the agent runs on invisibly for the life of the daemon.
      if (!this.store.get(taskId)) return undefined;
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

      const started = await this.awaitAgentStart(taskId, pty);
      // Checked again on the far side of the wait, which is where the window
      // actually is: a rung takes up to `startTimeoutMs` to settle, and a task
      // closed in the meantime must not end up owning the terminal we just
      // started for it.
      if (!this.store.get(taskId)) {
        this.discardPty(pty, taskId);
        return undefined;
      }
      if (started) {
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
    this.store.update(taskId, { lifecycle: "suspended", agent_state: "could_not_resume" });
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
    // `SessionStart` claims the task is live, and for a task with a terminal it
    // is. But `codetoaster hook` outlives the agent that spawned it — killing
    // the PTY does not signal it — so one can land just after `suspendTask`
    // killed everything, and taking its word would leave a row marked `live`
    // with `ptyId: null`: a task the sidebar shows as running that nothing is
    // behind, and whose freshly stamped `idle_since` keeps the harvester off it
    // for a full `harvestAfterMs`. The rest of the transition still applies —
    // it is only the claim about liveness that needs a process to back it.
    if (update.lifecycle === "live" && !this.primaryPty(taskId)) {
      delete update.lifecycle;
    }
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

  /** The task's agent terminal — the one its agent tab opens onto, the one a
   * snapshot is taken of, and the one asked where the task is. A task holds
   * shell tabs beside it (§3); none of them is ever this. */
  primaryPty(taskId: string): Pty | undefined {
    const ptyId = this.agentPtys.get(taskId);
    return ptyId === undefined ? undefined : this.ptys.get(ptyId);
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
    const row = this.store.get(taskId);
    if (!row || row.lifecycle !== "live") return undefined;
    // The agent's live grid, else the one the task was last seen at. Both are
    // what `taskInfo.size` reports, which is the size every client showing this
    // task has already negotiated down to.
    const taskSize = this.primaryPty(taskId)?.getSize() ?? {
      cols: row.last_size_cols ?? DEFAULT_SIZE.cols,
      rows: row.last_size_rows ?? DEFAULT_SIZE.rows,
    };
    const pty = this.ptys.spawn([process.env.SHELL || "/bin/sh"], {
      cols: options.cols ?? taskSize.cols,
      rows: options.rows ?? taskSize.rows,
      cwd: row.cwd,
      env: taskEnv(process.env, { taskId, port: this.port, origin: this.origin }),
    });
    this.adopt(pty, taskId, false);
    this.broadcastTask(taskId);
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
    this.ptys.kill(ptyId);
    this.ptyToTask.delete(ptyId);
    this.taskPtys.get(taskId)?.delete(ptyId);
    this.broadcastTask(taskId);
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

  /** The rows the idle harvester walks (§5.5). Rows rather than `TaskInfo`,
   * because what the guards ask about — `idle_since`, `agent_state` — is column
   * data that the rendered shape has no place for, and rows rather than
   * `listTasks`, which only sees the in-memory project grouping and so cannot
   * see a task the daemon adopted rather than created. */
  liveTasks(): TaskRow[] {
    return this.store.list({ lifecycle: "live" });
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
    if (!this.store.get(taskId)) return undefined;
    const last = this.cwdCheckedAt.get(taskId);
    if (last !== undefined && Date.now() - last < maxAgeMs) {
      return this.store.get(taskId)?.cwd;
    }
    this.cwdCheckedAt.set(taskId, Date.now());
    return this.refreshCwd(taskId);
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

  /** Write the task's screen to disk and record the grid it was at (§5.1).
   * False when there was nothing to write.
   *
   * What TASK-15's harvester calls before it kills an idle agent's terminal,
   * and what TASK-17's restore reads back. The size goes on the row in the same
   * breath because the two are one fact: a snapshot repainted into a grid it
   * was not taken at reflows into nonsense, and `runResumeLadder` already reads
   * `last_size_*` to size the terminal it spawns.
   *
   * A task with no live terminal keeps whatever snapshot it already has rather
   * than having it cleared. The file is only stale in the sense that the
   * process behind it is gone, which is precisely when a user wants to see it;
   * reconciling rows whose PTYs died with the daemon is `reconcileOnBoot`'s
   * job.
   *
   * It never throws. The harvester runs this across every live task on a timer,
   * so one task whose directory has been deleted under it must not take the
   * rest of the tick down with it. */
  async snapshot(taskId: string): Promise<boolean> {
    if (!this.store.get(taskId)) return false;
    const pty = this.primaryPty(taskId);
    if (!pty) return false;
    // The screen and the grid it was taken at, read together, because they are
    // one fact: a snapshot repainted into a grid it was not taken at reflows
    // into nonsense. Reading the size after the write would let them disagree —
    // the write is queued behind any earlier one for this task, and in that
    // window a client detaching or resizing re-runs smallest-wins and changes
    // the PTY's grid under us. The row would then claim the new size for a
    // screen serialized at the old one.
    const screen = pty.serialize();
    const size = pty.getSize();
    // A screen with nothing on it is nothing to write, not an empty screen.
    // `serialize` answers "" once the terminal is disposed, so that a stray call
    // cannot throw out of the harvester's tick — and a live terminal that has
    // painted nothing answers exactly the same, which is a second or two of
    // every resume: close the task between the spawn of `claude` and the agent's
    // first paint and this runs against a terminal with an empty buffer.
    // Persisting either "" would overwrite the last screen the task ever
    // painted, which is the opposite of what the no-PTY branch above is careful
    // to preserve — so both stop here, before the write and before the row is
    // told a size, since a `last_size_*` recorded for a screen that was never
    // written describes the screen that is still on disk.
    if (!screen) return false;
    try {
      await writeSnapshot(taskId, screen);
    } catch (e) {
      console.warn(`Could not write scrollback snapshot for task ${taskId}:`, e);
      return false;
    }
    // The task can be deleted while the write is in flight, and `deleteTask`
    // fires its own removal without awaiting it — so the removal can run first
    // and this write lands after it, recreating the directory and leaving a
    // multi-hundred-KB file for a row that no longer exists and an id that can
    // never be reissued. Exactly the leak the removal exists to prevent.
    if (!this.store.get(taskId)) {
      void removeSnapshot(taskId).catch(() => {});
      return false;
    }
    this.store.update(taskId, { last_size_cols: size.cols, last_size_rows: size.rows });
    return true;
  }

  /** Harvest a task: put the screen on disk, kill everything running behind
   * it, and leave the row saying so (§5.5). False for a task that is not there
   * or is not live — a suspended task has nothing left to take away, and
   * asking twice is something both the harvester's tick and a user's click can
   * do.
   *
   * This is the whole of what harvesting *does*; whether a given task should be
   * harvested is the caller's question. The idle harvester answers it with §5.5's
   * guards and `closeTask` answers it with a click, and neither one belongs in
   * here.
   *
   * The snapshot comes first, and the order is load-bearing: `Pty.kill`
   * disposes the headless terminal, `serialize` answers "" from then on, and
   * `snapshot` refuses to persist that — so a snapshot taken after the kill
   * would silently leave the task with whatever screen it had before this one,
   * which is exactly the screen the user is about to be shown when they reopen
   * it (§5.5, phase 1).
   *
   * The row and `~/.codetoaster/tasks/<id>/` both stay. Suspension is the
   * reversible level of gone (§5.6): the settings file is what the resumed
   * agent is started with, and the scrollback we just wrote is what the user
   * sees while it comes back. */
  async suspendTask(taskId: string): Promise<boolean> {
    // A resume in flight has to settle first. The ladder leaves the row
    // `suspended` for its whole run and only writes `live` on the rung that
    // works, so a close arriving mid-resume read "not live", answered false and
    // did nothing at all — and seconds later the ladder finished, wrote `live`
    // and handed the user back the agent they had just closed. The route
    // reported success either way, so there was nothing to say it had happened.
    // Waiting means the click lands on the task the resume produced, which is
    // the task the user was looking at when they clicked.
    const inFlight = this.resuming.get(taskId);
    if (inFlight) {
      await inFlight.catch(() => undefined);
      // Started over rather than fallen through, because settling that resume
      // is not the same as there being no resume. A `fresh` caller parks on the
      // very same promise and registers a *new* ladder the instant it settles —
      // and it registered its continuation before this one, so by the time we
      // get here the second ladder is already in `resuming`. Falling through
      // would run `doSuspend` alongside it: it reads a row still marked `live`,
      // takes no snapshot and kills nothing (the fresh start discarded the
      // PTYs), writes `suspended` and reports success — and then the ladder
      // writes `live` again, leaving an agent running on a task the user
      // closed. Asking again is the whole fix: the click lands on the task the
      // *last* resume produced.
      return this.suspendTask(taskId);
    }
    // Registered only now, on the far side of that wait, so a resume waiting on
    // us and a suspend waiting on it can never be waiting on each other. A
    // second close joins the first rather than snapshotting the task twice.
    const alreadySuspending = this.suspending.get(taskId);
    if (alreadySuspending) return alreadySuspending;
    const attempt = this.doSuspend(taskId).finally(() => {
      this.suspending.delete(taskId);
    });
    this.suspending.set(taskId, attempt);
    return attempt;
  }

  private async doSuspend(taskId: string): Promise<boolean> {
    const row = this.store.get(taskId);
    if (!row || row.lifecycle !== "live") return false;
    await this.snapshot(taskId);
    for (const ptyId of [...(this.taskPtys.get(taskId) ?? [])]) {
      // Every terminal the task holds, not just the agent's: a shell tab
      // (TASK-27) is a process in the task's directory like any other, and §5.5
      // harvests the task, not one of its processes.
      this.ptys.kill(ptyId);
      this.ptyToTask.delete(ptyId);
    }
    this.taskPtys.delete(taskId);
    this.agentPtys.delete(taskId);
    // What a task without a process cannot have: a clock waiting for an agent's
    // first hook, which would wake up and relabel a task that is deliberately
    // quiet; a record that the agent now gone had reported, which is a claim
    // about a process, not about a task (`spawnAgent` clears it for the same
    // reason on the way back); and a throttle timestamp for a cwd check that
    // was performed against a terminal that no longer exists, which would
    // otherwise suppress the first check after the task is resumed.
    this.disarmHookGrace(taskId);
    this.hookSeen.delete(taskId);
    this.cwdCheckedAt.delete(taskId);
    // Only the lifecycle. `agent_state` stays `idle`: that is what was true of
    // the agent when it was harvested and what the card should go on saying.
    // `reconcileOnBoot`'s `unknown` is the other case — a daemon that never
    // witnessed its agents die and cannot speak for what they were doing.
    this.store.update(taskId, { lifecycle: "suspended" });
    this.broadcastTask(taskId);
    return true;
  }

  /** Closing a task. Chat products have no "close", and neither does this one:
   * §6 makes the close button a suspend, and archive (TASK-31) the only way a
   * task truly leaves.
   *
   * It is `suspendTask` and nothing else on purpose. Manual close is the
   * harvest path minus the guards — §5.5's own wording — so the two must not be
   * able to drift: whatever harvesting learns to preserve, a user's click
   * preserves too. The guards are the entire difference, and they live with the
   * caller that has a reason to ask: the harvester answers "should this be
   * harvested?" with §5.5, and a click answers it by being a click. */
  closeTask(taskId: string): Promise<boolean> {
    return this.suspendTask(taskId);
  }

  /** The destructive door, and for now the only one: the row, the terminals and
   * the snapshot go away for good, and the id can never be reissued.
   *
   * This is what archive becomes (TASK-31) once it also has a worktree to clean
   * up and a decision to make about keeping the row. Until then it is reachable
   * only over `DELETE /api/tasks/:id` — the CLI's `codetoaster kill` — because
   * every path a browser can take now leads to `closeTask` instead.
   *
   * It deliberately leaves `~/.codetoaster/tasks/<id>/` behind, settings.json
   * and all, which is a few KB of JSON for a row nothing will ever read again.
   * Removing the directory is archive's job along with the worktree, and doing
   * it here would put a recursive rm under the user's home on a path this task
   * has no reason to touch yet.
   *
   * The scrollback snapshot is the exception, and only because of its size: a
   * multi-hundred-KB screen per deleted task is a different order of leak, and
   * unlike a suspended task's snapshot — which is exactly what reopening it
   * reads back (§5.5, phase 1) — this one has no row left to be read for. */
  deleteTask(taskId: string): boolean {
    if (!this.store.get(taskId)) return false;
    // Fired rather than awaited: delete is synchronous, and an unlink that fails
    // — a directory already removed by hand, a read-only home — must not be
    // allowed to fail the removal of a task that is otherwise gone.
    void removeSnapshot(taskId).catch(() => {});
    // Before the row goes: a timer that outlived its task would wake up to
    // relabel something that is no longer there.
    this.disarmHookGrace(taskId);
    this.hookSeen.delete(taskId);
    this.cwdCheckedAt.delete(taskId);
    for (const ptyId of [...(this.taskPtys.get(taskId) ?? [])]) {
      this.ptys.kill(ptyId);
      this.ptyToTask.delete(ptyId);
    }
    this.taskPtys.delete(taskId);
    this.agentPtys.delete(taskId);
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
    if (taskId) void this.refreshCwdIfStale(taskId).catch(() => {});

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
      projectId: row.project_id,
      ptyId: pty?.id ?? null,
      shellPtyIds: this.shellPtys(taskId).map((shell) => shell.id),
      title: row.title,
      titleSource: row.title_source,
      terminalTitle: pty?.title ?? "",
      agentState: row.agent_state,
      lifecycle: row.lifecycle,
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
   * That recency ordering is `store.list`'s own `last_active_at DESC`, which is
   * the order the sidebar wants and the order project grouping never gave it.
   */
  listTasks(): TaskInfo[] {
    const result: TaskInfo[] = [];
    for (const row of this.store.list({ lifecycle: ["live", "suspended"] })) {
      const info = this.taskInfo(row.id);
      if (info) result.push(info);
    }
    return result;
  }

  /** The titles a new task's derived name has to be unique against. Suspended
   * ones count: two tasks in the same directory derive the same "<dir> ·
   * <branch>" label, and a user who cannot tell the new one from the one they
   * suspended an hour ago is no better off than if both were live. */
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

  /** `projectId` is the one already written to the row, not a fresh
   * resolution: the two must not be able to disagree. Falls back to General if
   * the project was deleted while the create was awaiting, which is the same
   * place `deleteProject` would have moved the task to anyway. */
  private placeInProject(taskId: string, projectId: string, options: CreateTaskOptions): void {
    const project =
      this.projects.find((p) => p.id === projectId) ??
      this.projects.find((p) => p.id === "general");
    if (!project) return;
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
    // No defaults yet: `createProject` writes the identity columns only, so a
    // fresh project resolves to whatever the caller asks for until something
    // sets them.
    this.projects.push({
      id,
      name,
      initialPath,
      taskIds: [],
      defaultModel: null,
      defaultPermissionMode: null,
    });
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
