import type { ServerWebSocket } from "bun";
import type { Database } from "bun:sqlite";
import type { Pty } from "../xtmux/pty";
import type { SpawnOptions } from "../xtmux/pty-manager";
import type {
  ArchiveOutcome,
  ArchivePreview,
  DeleteOutcome,
  ProjectInfo,
  ProjectSettings,
  ServerMessage,
  TaskInfo,
  TaskWorktreeInfo,
  UnarchivePreview,
  WebSocketData,
} from "../xtmux/types";
import * as db from "../db";
import type { TaskRow } from "../db";
import { TaskStore, type TaskUpdate } from "./store";
import { builtinProfiles, type AgentProfile } from "../agent/profile";
import { ProfileRegistry } from "../agent/profiles";
import type { HookPayload } from "../agent/hook-state";
import { CheckoutWatchers } from "./checkout-watchers";
import { WorktreeStatusCache } from "./worktree-status";
import { BootReconciler } from "./boot";
import { TaskInfoProjection } from "./task-info";
import type { TaskHost } from "./host";
import { ProjectRegistry } from "./projects";
import { ClientRegistry } from "./clients";
import { TaskTerminals } from "./terminals";
import { TaskActivity } from "./activity";
import { TaskHooks } from "./hooks";
import { InFlight } from "./inflight";
import { TaskCreation } from "./create";
import { TaskResumption } from "./resume";
import { TaskSuspension } from "./suspend";
import { TaskArchive } from "./archive";
import type { ProcessRoot } from "../processes";
import type {
  ReconcileReport,
  RestoredWorktree,
  UnclaimedWorktree,
  WipSnapshot,
} from "../worktree";

export { NotArchivedError, WIP_RETENTION_MS } from "./archive";
export { RERANK_QUIET_MS } from "./activity";

// `ArchiveOutcome`, `ArchivePreview` and `DeleteOutcome` used to be declared
// here. They are serialized straight out of the archive and delete routes and
// read by the sidebar's confirmations, which makes them wire shapes — so they
// live in `xtmux/types` with the rest of the contract, and are re-exported
// here because this is the entry point that produces them (archive.ts).
export type { ArchiveOutcome, ArchivePreview, DeleteOutcome, UnarchivePreview };

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
  /** Which agent to run this task on: a *name* in the daemon's registry, never
   * a command (TASK-89). A profile is a command template, and one arriving from
   * a caller would be the raw argv over HTTP that TASK-42 closed off — see
   * `agent/profiles.ts`. Absent means `claude`; TASK-89.3 puts the project's
   * default in between. */
  profile?: string;
  /** Give the task a checkout of its own (§5.6). Absent means the project's
   * `worktree_default`, resolved here rather than in the client so the HTTP
   * API and the CLI answer the same as the composer. */
  worktree?: boolean;
  /** What that checkout branches from. Absent means the project's
   * `default_base_ref`, and absent again means `HEAD`. */
  baseRef?: string;
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
export class TaskManager implements TaskHost {
  private database?: Database;

  private readonly inflight = new InFlight();
  private readonly projectRegistry = new ProjectRegistry(this);
  /** Which agents this daemon can run a task on (TASK-89). The built-ins until
   * the server replaces it at startup, so the module-level manager and every
   * test have a working registry without wiring one up — and so a `claude` task
   * is spawned identically whether or not anything ever called `setProfiles`.
   *
   * @internal — for the src/lib/tasks modules (TaskHost). */
  profiles = new ProfileRegistry(builtinProfiles());
  private readonly clients = new ClientRegistry(this);
  private readonly checkoutWatchers = new CheckoutWatchers(this);
  private readonly worktreeStatuses = new WorktreeStatusCache(this);
  private readonly boot = new BootReconciler(this);
  private readonly projection = new TaskInfoProjection(this);
  private readonly terminals = new TaskTerminals(this);
  private readonly activity = new TaskActivity(this);
  private readonly hooks = new TaskHooks(this);
  private readonly creation = new TaskCreation(this);
  private readonly resumption = new TaskResumption(this, this.inflight);
  private readonly suspension = new TaskSuspension(this, this.inflight);
  private readonly archive = new TaskArchive(this, this.inflight);
  // What `codetoaster hook` has to POST back to (§4.2), handed over by
  // startServer. Undefined until then: a manager with no server in front of it
  // — a test — has no port to name, and an agent spawned from one simply
  // reports nowhere.
  /** @internal — for the src/lib/tasks modules (TaskHost). */
  port?: number;
  // And where it answers, when that is not loopback. A `--host` bind makes
  // `http://localhost:<port>` refuse the connection, so the reporter cannot
  // assemble its own URL from the port alone.
  /** @internal — for the src/lib/tasks modules (TaskHost). */
  origin?: string;

  /** Takes the database to work against; defaults to the process-wide one.
   * Tasks and projects both come from it, so a caller cannot end up reading
   * one out of one database and the other out of another. */
  constructor(database?: Database) {
    this.database = database;
  }

  // Resolved on first use, not in the constructor: the module-level manager is
  // built at import time, and the database is only opened once the daemon
  // knows which file it is running against.
  /** @internal — for the src/lib/tasks modules (TaskHost). */
  get db(): Database {
    return this.database ?? db.getDatabase();
  }

  private cachedStore?: TaskStore;
  private cachedStoreDb?: Database;
  /** @internal — for the src/lib/tasks modules (TaskHost). */
  get store(): TaskStore {
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

  /** The live array, read through on each access: `loadProjects` and
   * `reorderProjects` replace it, and its readers edit its `taskIds`.
   *
   * @internal — for the src/lib/tasks modules (TaskHost). */
  get projects(): ProjectInfo[] {
    return this.projectRegistry.projects;
  }

  // ---------------------------------------------------------------- startup

  /** The port the daemon ended up on, which every task's environment carries
   * so its hooks can reach us. Set once, at startup, before any task exists. */
  setPort(port: number, origin?: string): void {
    this.port = port;
    this.origin = origin;
  }

  /** The agents this daemon can run a task on, read from its configuration
   * (TASK-89). Set once, at startup, before any task can be created — a task
   * already running holds its profile's *name* on its row, so a registry
   * replaced underneath it changes what the next resume renders. */
  setProfiles(registry: ProfileRegistry): void {
    this.profiles = registry;
  }

  setHookGrace(ms: number): void {
    this.activity.setHookGrace(ms);
  }

  setStartTimeout(ms: number): void {
    this.resumption.setStartTimeout(ms);
  }

  setCwdRefreshWindow(ms: number): void {
    this.terminals.setCwdRefreshWindow(ms);
  }

  loadProjects(): void {
    this.projectRegistry.loadProjects();
  }

  reconcileOnBoot(): number {
    return this.boot.reconcileOnBoot();
  }

  reconcileWorktreesOnBoot(): Promise<ReconcileReport> {
    return this.boot.reconcileWorktreesOnBoot();
  }

  setWorktreeStatusTtl(ms: number): void {
    this.worktreeStatuses.setWorktreeStatusTtl(ms);
  }

  refreshWorktreeStatus(taskId: string, options: { force?: boolean } = {}): Promise<void> {
    return this.worktreeStatuses.refreshWorktreeStatus(taskId, options);
  }

  refreshStaleWorktreeStatuses(): Promise<void> {
    return this.worktreeStatuses.refreshStaleWorktreeStatuses();
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  worktreeStatusOf(taskId: string): TaskWorktreeInfo | undefined {
    return this.worktreeStatuses.worktreeStatus.get(taskId);
  }

  getUnclaimedWorktrees(): UnclaimedWorktree[] {
    return this.boot.getUnclaimedWorktrees();
  }

  deleteUnclaimedWorktree(worktreePath: string): Promise<boolean> {
    return this.boot.deleteUnclaimedWorktree(worktreePath);
  }

  // ----------------------------------------------------------------- clients

  registerClient(clientId: string, ws: ServerWebSocket<WebSocketData>): void {
    this.clients.registerClient(clientId, ws);
  }

  unregisterClient(clientId: string): void {
    this.clients.unregisterClient(clientId);
  }

  broadcastToAll(message: object): void {
    this.clients.broadcastToAll(message);
  }

  tasksSnapshot(): ServerMessage {
    return this.clients.tasksSnapshot();
  }

  broadcastTasks(): void {
    this.clients.broadcastTasks();
  }

  broadcastTask(taskId: string): void {
    this.clients.broadcastTask(taskId);
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  clientCount(): number {
    return this.clients.connectedClients.size;
  }

  // -------------------------------------------------------------- watchers

  reconcileWatchers(): void {
    this.checkoutWatchers.reconcileWatchers();
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  reconcileWatcher(row: TaskRow): void {
    this.checkoutWatchers.reconcileWatcher(row);
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  stopWatcher(taskId: string): void {
    this.checkoutWatchers.stopWatcher(taskId);
  }

  watchedTaskIds(): string[] {
    return this.checkoutWatchers.watchedTaskIds();
  }

  watchedRoots(): Record<string, string> {
    return this.checkoutWatchers.watchedRoots();
  }

  stopWatchers(): void {
    this.checkoutWatchers.stopWatchers();
  }

  // ------------------------------------------------------------------ tasks

  createTask(options: CreateTaskOptions): Promise<TaskRow> {
    return this.creation.createTask(options);
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  recordSetupOutcome(taskId: string): Promise<void> {
    return this.resumption.recordSetupOutcome(taskId);
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  setSpawnedAt(taskId: string, at: number): void {
    this.resumption.setSpawnedAt(taskId, at);
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  clearSpawnedAt(taskId: string): void {
    this.resumption.clearSpawnedAt(taskId);
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  clearRestarted(taskId: string): void {
    this.resumption.clearRestarted(taskId);
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  spawnPty(command: string[], options: SpawnOptions): Pty {
    return this.terminals.spawnPty(command, options);
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  adopt(pty: Pty, taskId: string): void {
    this.terminals.adopt(pty, taskId);
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  agentPtyId(taskId: string): string | undefined {
    return this.terminals.agentPtyId(taskId);
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  forgetAgentPty(taskId: string): void {
    this.terminals.forgetAgentPty(taskId);
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  unmapAndKill(taskId: string, ptyIds: readonly string[]): void {
    this.terminals.unmapAndKill(taskId, ptyIds);
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  taskPtyIds(taskId: string): string[] {
    return this.terminals.taskPtyIds(taskId);
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  forgetTaskPtys(taskId: string): void {
    this.terminals.forgetTaskPtys(taskId);
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  forgetCwdCheck(taskId: string): void {
    this.terminals.forgetCwdCheck(taskId);
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  stampActivity(
    taskId: string,
    ptyId: string,
    active: boolean,
    now: number,
    rank: boolean,
  ): { rankAt?: number; longGap: boolean } {
    return this.activity.stampActivity(taskId, ptyId, active, now, rank);
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  stampRank(taskId: string, at: number, extra?: TaskUpdate): TaskRow | undefined {
    return this.activity.stampRank(taskId, at, extra);
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  wakeOnInput(ptyId: string, data: string): void {
    this.activity.wakeOnInput(ptyId, data);
  }

  setOutputEdgeAt(ptyId: string, at: number): void {
    this.activity.setOutputEdgeAt(ptyId, at);
  }

  setRankAt(taskId: string, at: number): void {
    this.activity.setRankAt(taskId, at);
  }

  outputEdgeOf(ptyId: string): number | undefined {
    return this.activity.outputEdgeOf(ptyId);
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  seedOutputEdge(ptyId: string, at: number): void {
    this.activity.seedOutputEdge(ptyId, at);
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  forgetOutputEdge(ptyId: string): void {
    this.activity.forgetOutputEdge(ptyId);
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  forgetRankAt(taskId: string): void {
    this.activity.forgetRankAt(taskId);
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  hasSeenHook(taskId: string): boolean {
    return this.hooks.hasSeenHook(taskId);
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  forgetAgentProcess(taskId: string): void {
    this.hooks.forgetAgentProcess(taskId);
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  inferState(taskId: string, active: boolean): void {
    this.activity.inferState(taskId, active);
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  armHookGrace(taskId: string): void {
    this.activity.armHookGrace(taskId);
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  disarmHookGrace(taskId: string): void {
    this.activity.disarmHookGrace(taskId);
  }

  // ----------------------------------------------------------------- resume

  resumeTask(
    taskId: string,
    options: { fresh?: boolean; cols?: number; rows?: number } = {},
  ): Promise<TaskRow | undefined> {
    return this.resumption.resumeTask(taskId, options);
  }

  applyHook(taskId: string, payload: HookPayload): boolean {
    return this.hooks.applyHook(taskId, payload);
  }

  getTask(taskId: string): TaskRow | undefined {
    return this.store.get(taskId);
  }

  taskIdForPty(ptyId: string): string | undefined {
    return this.terminals.taskIdForPty(ptyId);
  }

  primaryPty(taskId: string): Pty | undefined {
    return this.terminals.primaryPty(taskId);
  }

  processRoots(taskId: string): ProcessRoot[] {
    return this.terminals.processRoots(taskId);
  }

  shellPtys(taskId: string): Pty[] {
    return this.terminals.shellPtys(taskId);
  }

  openShell(taskId: string, options: { cols?: number; rows?: number } = {}): Pty | undefined {
    return this.terminals.openShell(taskId, options);
  }

  closeShell(taskId: string, ptyId: string): boolean {
    return this.terminals.closeShell(taskId, ptyId);
  }

  taskPtyList(taskId: string): Pty[] {
    return this.terminals.taskPtyList(taskId);
  }

  /** The rows the idle harvester walks (§5.5). Rows rather than `TaskInfo`,
   * because what the guards ask about — `idle_since`, `agent_state` — is column
   * data that the rendered shape has no place for, and rows rather than
   * `listTasks`, which only sees the in-memory project grouping and so cannot
   * see a task the daemon adopted rather than created. */
  liveTasks(): TaskRow[] {
    return this.store.list({ lifecycle: "live" });
  }

  getPty(ptyId: string): Pty | undefined {
    return this.terminals.getPty(ptyId);
  }

  refreshCwdIfStale(taskId: string, maxAgeMs?: number): Promise<string | undefined> {
    return this.terminals.refreshCwdIfStale(taskId, maxAgeMs);
  }

  refreshCwd(taskId: string): Promise<string | undefined> {
    return this.terminals.refreshCwd(taskId);
  }

  renameTask(taskId: string, title: string): boolean {
    // An explicit rename opts the task out of derivation for good.
    if (!this.store.update(taskId, { title, title_source: "manual" })) return false;
    this.broadcastTask(taskId);
    return true;
  }

  // ------------------------------------------------------ suspend and evict

  snapshot(taskId: string): Promise<boolean> {
    return this.suspension.snapshot(taskId);
  }

  suspendTask(taskId: string): Promise<boolean> {
    return this.suspension.suspendTask(taskId);
  }

  harvestTask(taskId: string, stillHarvestable: () => boolean): Promise<boolean> {
    return this.suspension.harvestTask(taskId, stillHarvestable);
  }

  closeTask(taskId: string): Promise<boolean> {
    return this.suspension.closeTask(taskId);
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  repoRootFor(row: TaskRow): Promise<string | null> {
    return this.suspension.repoRootFor(row);
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  resolveRepoRoot(row: TaskRow): Promise<string | null> {
    return this.projectRegistry.resolveRepoRoot(row);
  }

  applyTaskWip(taskId: string): Promise<boolean> {
    return this.suspension.applyTaskWip(taskId);
  }

  discardTaskWip(taskId: string): Promise<boolean> {
    return this.suspension.discardTaskWip(taskId);
  }

  evictTask(taskId: string): Promise<boolean> {
    return this.suspension.evictTask(taskId);
  }

  evictProject(projectId: string): Promise<number> {
    return this.suspension.evictProject(projectId);
  }

  snapshotTaskWip(taskId: string): Promise<WipSnapshot | null> {
    return this.suspension.snapshotTaskWip(taskId);
  }

  restoreTaskWorktree(taskId: string): Promise<RestoredWorktree | null> {
    return this.suspension.restoreTaskWorktree(taskId);
  }

  // ---------------------------------------------------------------- archive

  archivePreview(taskId: string): Promise<ArchivePreview | null> {
    return this.archive.archivePreview(taskId);
  }

  archiveTask(taskId: string): Promise<ArchiveOutcome | null> {
    return this.archive.archiveTask(taskId);
  }

  expireArchivedWip(retentionMs?: number, now?: number): Promise<number> {
    return this.archive.expireArchivedWip(retentionMs, now);
  }

  unarchivePreview(taskId: string): Promise<UnarchivePreview | null> {
    return this.archive.unarchivePreview(taskId);
  }

  unarchiveTask(
    taskId: string,
    size: { cols?: number; rows?: number } = {},
  ): Promise<TaskRow | undefined | null> {
    return this.archive.unarchiveTask(taskId, size);
  }

  /** The rows the evict tier walks (§5.6). Suspended rather than live, which is
   * the whole difference between the two tiers: one reclaims processes from
   * tasks nobody is using, the other reclaims disk from tasks that already have
   * no processes. */
  suspendedTasks(): TaskRow[] {
    return this.store.list({ lifecycle: "suspended" });
  }

  /** Every task's opening prompt, at every lifecycle (§5.5, TASK-94) — what
   * the uploads tier weighs a staging directory against. See
   * `TaskStore.initialPrompts` for why it is one column and unfiltered. */
  taskPrompts(): string[] {
    return this.store.initialPrompts();
  }

  deleteTask(taskId: string): Promise<DeleteOutcome | null> {
    return this.archive.deleteTask(taskId);
  }

  acknowledgeTask(taskId: string): void {
    this.terminals.acknowledgeTask(taskId);
  }

  // ------------------------------------------------------------- attachment

  attachClient(
    ptyId: string,
    clientId: string,
    ws: ServerWebSocket<WebSocketData>,
    cols?: number,
    rows?: number,
  ): Pty | undefined {
    return this.terminals.attachClient(ptyId, clientId, ws, cols, rows);
  }

  detachClient(clientId: string, ptyId?: string): void {
    this.terminals.detachClient(clientId, ptyId);
  }

  writeToPty(clientId: string, ptyId: string, data: string): boolean {
    return this.terminals.writeToPty(clientId, ptyId, data);
  }

  typeIntoPty(ptyId: string, data: string): boolean {
    return this.terminals.typeIntoPty(ptyId, data);
  }

  resizePty(clientId: string, ptyId: string, cols: number | null, rows: number | null): boolean {
    return this.terminals.resizePty(clientId, ptyId, cols, rows);
  }

  getClientPtyIds(clientId: string): string[] {
    return this.terminals.getClientPtyIds(clientId);
  }

  /** What the manager is holding, for `/api/diagnostics` (TASK-134). */
  diagnosticCounts(): { ptys: number; clients: number; watchedTasks: number } {
    return {
      ptys: this.terminals.ptys.size,
      clients: this.clientCount(),
      // A watch that died stays in the map until its retry, holding no stream.
      watchedTasks: [...this.checkoutWatchers.watchers.values()].filter((entry) => entry.failedAt === undefined).length,
    };
  }

  getConnections(): Array<{ clientId: string; ptyIds: string[] }> {
    return this.clients.getConnections();
  }

  // -------------------------------------------------------------- rendering

  taskInfo(taskId: string): TaskInfo | undefined {
    return this.projection.taskInfo(taskId);
  }

  listTasks(): TaskInfo[] {
    return this.projection.listTasks();
  }

  listArchivedTasks(): TaskInfo[] {
    return this.projection.listArchivedTasks();
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  taskTitles(): string[] {
    return this.projection.taskTitles();
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  isRestarted(taskId: string): boolean {
    return this.resumption.isRestarted(taskId);
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  isEvicting(taskId: string): boolean {
    return this.inflight.evicting.has(taskId);
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  isArchiving(taskId: string): boolean {
    return this.inflight.archiving.has(taskId);
  }

  // --------------------------------------------------------------- projects

  hasProject(projectId: string): boolean {
    return this.projectRegistry.hasProject(projectId);
  }

  getProjects(): ProjectInfo[] {
    return this.projectRegistry.getProjects();
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  rankedProjects(): ProjectInfo[] {
    return this.projectRegistry.rankedProjects();
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  resolveProjectId(options: CreateTaskOptions): string {
    return this.projectRegistry.resolveProjectId(options);
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  ensureInProject(taskId: string): void {
    this.projectRegistry.ensureInProject(taskId);
  }

  /** @internal — for the src/lib/tasks modules (TaskHost). */
  placeInProject(taskId: string, projectId: string, options: CreateTaskOptions): void {
    this.projectRegistry.placeInProject(taskId, projectId, options);
  }

  /** What this daemon can run a task on, in the order the composer offers it:
   * the built-ins, then anything `profiles.json` added (TASK-89.2). The client
   * renders from this rather than from a list of its own, so a user-defined
   * profile is choosable without a rebuild — and a build that dropped one
   * cannot go on offering it. */
  listProfiles(): AgentProfile[] {
    return this.profiles.list();
  }

  createProject(
    id: string,
    name: string,
    initialPath: string,
    settings?: Partial<ProjectSettings>,
  ): void {
    this.projectRegistry.createProject(id, name, initialPath, settings);
  }

  updateProject(
    id: string,
    name: string,
    initialPath: string,
    settings?: Partial<ProjectSettings>,
  ): boolean {
    return this.projectRegistry.updateProject(id, name, initialPath, settings);
  }

  deleteProject(id: string): boolean {
    return this.projectRegistry.deleteProject(id);
  }

  reorderProjects(orderedProjects: Array<{ id: string; taskIds: string[] }>): void {
    this.projectRegistry.reorderProjects(orderedProjects);
  }
}

export const taskManager = new TaskManager();
