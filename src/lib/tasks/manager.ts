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
import { buildAgentCommand, taskDir, taskEnv } from "../agent/spawn";
import { writeTaskSettings } from "../agent/settings";
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
  // What `codetoaster hook` has to POST back to (§4.2), handed over by
  // startServer. Undefined until then: a manager with no server in front of it
  // — a test — has no port to name, and an agent spawned from one simply
  // reports nowhere.
  private port?: number;

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
  setPort(port: number): void {
    this.port = port;
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
        env: taskEnv(process.env, { taskId: id, port: this.port }),
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
      this.broadcastToAll({ type: "activity", taskId, active });
    });
    pty.onNotification((_ptyId, title, body) => {
      this.broadcastToAll({ type: "notification", taskId, title, body });
      this.broadcastTask(taskId);
    });
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
