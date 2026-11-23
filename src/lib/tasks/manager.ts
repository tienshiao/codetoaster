import type { ServerWebSocket } from "bun";
import type { Database } from "bun:sqlite";
import * as fs from "fs";
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
  UnarchiveCheckout,
  UnarchivePreview,
  UnarchiveSnapshot,
  WebSocketData,
} from "../xtmux/types";
import * as db from "../db";
import type { TaskRow } from "../db";
import { TaskStore, type TaskUpdate } from "./store";
import { removeTaskDir } from "../agent/spawn";
import { builtinProfiles, type AgentProfile } from "../agent/profile";
import { ProfileRegistry } from "../agent/profiles";
import type { HookPayload } from "../agent/hook-state";
import { removeSnapshot } from "./snapshot";
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
import type { ProcessRoot } from "../processes";
import {
  branchIsExpendable,
  branchStatus,
  deleteBranch,
  dropWip,
  evictWorktree,
  lockKeyFor,
  readWip,
  recreateBranch,
  resolveCommit,
  withRepoLock,
  WorktreeError,
  type BranchStatus,
  type ReconcileReport,
  type RestoredWorktree,
  type UnclaimedWorktree,
  type WipSnapshot,
} from "../worktree";

/** Why a branch outlived the task it belonged to, for the dialog to print.
 *
 * Reached only when the branch was *not* expendable, so both halves are always
 * false and the sentence is about what is still on it. The count is the point:
 * "kept" on its own reads as an apology for not cleaning up, while "kept — 3
 * commits are on it and nowhere else" reads as the reason it was kept, and
 * tells the user what to do next. */
function keptReason(branch: string, baseRef: string | null, status: BranchStatus): string {
  const base = baseRef ? ` into ${baseRef}` : "";
  const kept = `${branch} was kept: it is not merged${base} and not on any remote`;
  // The count is dropped rather than printed as zero. `branchStatus` answers 0
  // when the count itself failed, and "0 commits would have gone with it" reads
  // as a reason the branch should have been deleted — the opposite of the
  // sentence it is in. The two facts that decided this both fail closed and are
  // already stated above; the number is the detail, not the argument.
  if (status.unpushed === 0) return kept;
  const commits = status.unpushed === 1 ? "1 commit" : `${status.unpushed} commits`;
  return `${kept}, so ${commits} would have gone with it`;
}

/** §5.6's retention: how long an archived task keeps the snapshot that makes
 * archiving recoverable. Long, because the whole promise of the confirmation
 * dialog is that the user is choosing something they can come back from — and
 * a ref costs a commit object, which is the cheapest thing in the design. */
export const WIP_RETENTION_MS = 30 * 24 * 60 * 60_000;

export { RERANK_QUIET_MS } from "./activity";

// `ArchiveOutcome`, `ArchivePreview` and `DeleteOutcome` used to be declared
// here. They are serialized straight out of the archive and delete routes and
// read by the sidebar's confirmations, which makes them wire shapes — so they
// live in `xtmux/types` with the rest of the contract, and are re-exported
// here because this is where they are produced.
export type { ArchiveOutcome, ArchivePreview, DeleteOutcome, UnarchivePreview };

/** An unarchive asked of a task that is not archived (TASK-139).
 *
 * A throw rather than a null, because null already means "no such task" and the
 * route answers the two differently: a 404 for a task that is not there, a 409
 * for one that is there and simply is not in the state the request assumed — a
 * second browser confirming a dialog the first already acted on. */
export class NotArchivedError extends Error {
  constructor(taskId: string) {
    super(`Task "${taskId}" is not archived`);
    this.name = "NotArchivedError";
  }
}

/** What `planUnarchive` decided: the preview the user is shown, and the two
 * facts the act needs that the preview does not carry. */
interface UnarchivePlan {
  preview: UnarchivePreview;
  repoRoot: string | null;
  /** The commit to recreate the deleted branch at, or null to leave the
   * branch alone (it exists, or the task never had one). */
  recreateAt: string | null;
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
    return this.terminals.ptys.spawn(command, options);
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

  /** What archiving this task would cost, before it is confirmed (§5.6).
   *
   * The read half of `archiveTask`, run on the same row by the same code, so
   * the dialog cannot state one thing and the button do another for any reason
   * except time passing between them. Null for a task that is not there.
   *
   * Cheap enough to call on a click: four gits against refs, one `status` in
   * the checkout. It is deliberately not cached — a preview that is a minute
   * old is exactly the preview that misleads.
   */
  async archivePreview(taskId: string): Promise<ArchivePreview | null> {
    const row = this.store.get(taskId);
    if (!row) return null;
    // The repository is only asked for when there is a branch to ask about:
    // `repoRootFor` writes its answer back onto the row, and `worktree_repo` is
    // documented as null for a task with no checkout of its own — a preview
    // should not be what changes that.
    const repoRoot = row.branch ? await this.repoRootFor(row) : null;
    const status = await this.branchStatusOf(row, repoRoot);
    return {
      status,
      branch: row.branch,
      branchWouldBeDeleted: status !== null && status.exists && branchIsExpendable(status),
      wipRetentionDays: Math.round(WIP_RETENTION_MS / 86_400_000),
    };
  }

  /** The git facts about a task's own branch, or null when it has none.
   *
   * `worktreePath` is passed only for a checkout that is genuinely on disk, so
   * an evicted task answers `dirty: null` — "there is no working tree to be
   * dirty" — rather than the `0` a missing directory would otherwise read as.
   * The two are not the same claim, and this is the number a confirmation
   * dialog prints. */
  private async branchStatusOf(row: TaskRow, repoRoot: string | null): Promise<BranchStatus | null> {
    if (!row.branch || !repoRoot) return null;
    const onDisk = row.worktree_state === "present"
      && !!row.worktree_path
      && fs.existsSync(row.worktree_path);
    return await branchStatus(repoRoot, {
      branch: row.branch,
      baseRef: row.base_ref,
      worktreePath: onDisk ? row.worktree_path : null,
    });
  }

  /** Archive a task: the only way one truly leaves (§5.6, §6).
   *
   * Everything below the snapshot is destruction, and the snapshot is the whole
   * of what makes it recoverable — so the order is the design, not a
   * convenience:
   *
   * 1. **Suspend first**, and through the ordinary door. A live task has an
   *    agent in the directory about to be removed, and `suspendTask` is what
   *    knows how to put one down — writing the screen, killing every terminal
   *    the task holds, disarming the clocks. Reimplementing that here would be
   *    a second harvester free to drift from the one §5.5 describes.
   * 2. **Read the status while there is still something to read.** `dirty` is a
   *    `git status` in a checkout that step 4 deletes, so the outcome has to be
   *    taken now or not at all — and it is what tells the user what they spent.
   * 3. **Snapshot unconditionally**, clean tree or not. A ref written only for a
   *    dirty tree would collapse "there was nothing to save" and "we never got
   *    to it" into one answer, and the confirmation promises a recoverable
   *    action rather than a bet. A snapshot that fails aborts the archive: the
   *    checkout is still there, and nothing has been lost by stopping.
   * 4. Remove the checkout, keeping the branch — `evictWorktree`, not
   *    `removeWorktree`, which exists to undo a failed create and takes the
   *    branch with it.
   * 5. **Delete the branch only if its commits survive it** — merged into
   *    `base_ref`, or contained in some remote. The default leans towards
   *    keeping, because a ref costs nothing next to losing commits, and the
   *    outcome says in words why one was kept so the user is not left guessing
   *    at a branch they did not expect to still have.
   * 6. Take `~/.codetoaster/tasks/<id>/` with it. `closeTask` leaves that
   *    standing on purpose — the settings are what the resumed agent starts
   *    with and the scrollback is what the user sees while it comes back — and
   *    an archived task is resumed by nothing.
   *
   * The row is kept, behind `lifecycle = archived`: `listTasks` shows live and
   * suspended, so the task leaves the sidebar without leaving the database, and
   * §7.5's archived toggle has something to show. Null for a task that is not
   * there or has already been archived — asking twice is what two browsers
   * showing the same dialog do.
   */
  async archiveTask(taskId: string): Promise<ArchiveOutcome | null> {
    // A resume in flight settles first, for the reason `evictTask` refuses
    // against one: the ladder leaves the row `suspended` for its entire run and
    // only writes `live` on the rung that works, so "is this task live?" — the
    // question step 1 asks to decide whether to suspend — answers *no* for a
    // task somebody is in the middle of reopening. Without this wait the
    // archive skips the suspend entirely and removes the directory the restore
    // has just rebuilt, with the agent already spawned into it; and the ladder,
    // still running, then writes `lifecycle: live` back over the `archived`
    // this wrote, putting a task with no checkout and no settings directory
    // back in the sidebar. Waited on *before* registering below, so the resume
    // side's wait on `archiving` and this one can never be waiting on each
    // other. Started over rather than fallen through, because settling that
    // resume is not the same as there being no resume — a `fresh` caller
    // registers a new ladder the instant the first settles.
    const resumeInFlight = this.inflight.resuming.get(taskId);
    if (resumeInFlight) {
      await resumeInFlight.catch(() => undefined);
      return this.archiveTask(taskId);
    }
    // An eviction in flight settles first, and then this starts over against
    // the row it left. It is about to remove the very checkout step 3 wants to
    // snapshot, and `snapshotTaskWip` refuses mid-eviction anyway — so racing
    // it would abort the archive for a reason that resolves itself in a moment.
    // Waited on *before* registering below, so the eviction side's refusal and
    // this wait can never be waiting on each other.
    const evictInFlight = this.inflight.evicting.get(taskId);
    if (evictInFlight) {
      await evictInFlight.catch(() => undefined);
      return this.archiveTask(taskId);
    }
    // An unarchive in flight settles first, and then this archives what it
    // produced — the live task, with its checkout rebuilt. Without the wait an
    // archive landing between the unarchive's lifecycle flip and its resume
    // would remove the checkout the ladder is about to restore, and the ladder
    // would then write `live` over this `archived`. Waited on before
    // registering, as `unarchiveTask` waits on this map before registering in
    // its own, so neither can be waiting on the other.
    const unarchiveInFlight = this.inflight.unarchiving.get(taskId);
    if (unarchiveInFlight) {
      await unarchiveInFlight.catch(() => undefined);
      return this.archiveTask(taskId);
    }
    const already = this.inflight.archiving.get(taskId);
    if (already) return already;
    const attempt = this.doArchive(taskId).finally(() => {
      this.inflight.archiving.delete(taskId);
    });
    this.inflight.archiving.set(taskId, attempt);
    return attempt;
  }

  private async doArchive(taskId: string): Promise<ArchiveOutcome | null> {
    const opening = this.store.get(taskId);
    if (!opening) return null;
    if (opening.lifecycle === "archived") return null;
    if (opening.lifecycle === "live") await this.suspendTask(taskId);

    // Re-read on the far side of the suspend, which writes the row and can take
    // as long as a multi-hundred-KB screen takes to reach the disk.
    const row = this.store.get(taskId);
    if (!row) return null;

    // Resolved once and handed down, rather than asked for by each step: a task
    // whose `worktree_repo` was never written resolves it by running git
    // against the project, and doing that three times over one archive is three
    // chances for the answer to change mid-operation.
    const repoRoot = row.worktree_state === "none" ? null : await this.repoRootFor(row);
    const status = await this.branchStatusOf(row, repoRoot);

    let wipRef = row.wip_ref;
    const onDisk = row.worktree_state === "present"
      && !!row.worktree_path
      && fs.existsSync(row.worktree_path);
    // A ref already on the row is a snapshot the restore refused to apply, and
    // it is the user's outstanding apply/keep/discard — but it is also, and
    // more importantly here, a commit holding work. Taking a fresh one would
    // move the ref off it and answer their question by destroying the thing
    // they were being asked about, so the refused snapshot *is* the archive's
    // snapshot and the decision travels with it into the retention window.
    if (onDisk && !row.wip_ref) {
      const taken = await this.snapshotTaskWip(taskId);
      if (!taken) {
        throw new WorktreeError(
          "snapshot-failed",
          `Could not snapshot "${row.title}" before archiving it, so nothing was removed`,
        );
      }
      wipRef = taken.ref;
    }

    if (repoRoot && row.worktree_path) {
      // For a `missing` checkout too, not only a present one: the directory is
      // gone but git's registration of it under `.git/worktrees` is not, and
      // `discardCheckout` prunes on its way past. Leaving that behind is what
      // makes a repository accumulate worktrees nothing will ever name again.
      await evictWorktree(repoRoot, row.worktree_path);
    }

    // After the checkout is gone, and that order is not stylistic: git refuses
    // to delete a branch that is checked out in one of its worktrees, so a
    // branch deletion attempted first would fail on exactly the tasks this is
    // for.
    let branchDeleted = false;
    let branchKept: string | null = null;
    if (row.branch && repoRoot && status?.exists) {
      if (branchIsExpendable(status)) {
        branchDeleted = await deleteBranch(repoRoot, row.branch);
        // Git refused after we had established it was safe — a worktree that
        // would not go, most likely. Reported rather than thrown: the archive
        // has already done everything else, and a branch that is still there is
        // the harmless half of the two ways this can end.
        if (!branchDeleted) branchKept = `git would not delete ${row.branch}`;
      } else {
        branchKept = keptReason(row.branch, row.base_ref, status);
      }
    }

    await removeTaskDir(taskId);
    // The stamp it dated went with that directory, and an archived task never
    // spawns again — so the entry would sit in the map for the life of the
    // daemon. `deleteTask` clears it for the same reason.
    this.clearSpawnedAt(taskId);

    const outcome: ArchiveOutcome = {
      status,
      branch: row.branch,
      branchDeleted,
      branchKept,
      wipRef,
    };
    // Deleted while git was working: nothing to write back, and the ref is left
    // for the retention sweep rather than resurrected as a row holding one
    // column — the same rule every other write here follows.
    if (!this.store.get(taskId)) return outcome;
    this.store.update(taskId, {
      lifecycle: "archived",
      // The directory is gone and the path is remembered, which is exactly what
      // `evicted` says. Not `none`: that means a task that runs in the
      // project's own directory and never had a checkout, and an archived task
      // reading that way would be indistinguishable from one there was never
      // anything to clean up for.
      ...(row.worktree_state === "none" ? {} : { worktree_state: "evicted" }),
      // Restamped, even for a ref that was already there. Retention is measured
      // from the archive, because that is when the user was told they had N
      // days — a refused snapshot taken three weeks ago would otherwise expire
      // in the week after they archived it.
      ...(wipRef ? { wip_at: Date.now() } : {}),
    });
    // The whole list, not the row: an archived task leaves `listTasks`, and a
    // `task` delta for a row that is no longer in the snapshot would leave every
    // attached client holding it.
    this.broadcastTasks();
    return outcome;
  }

  /** Drop the snapshots of archived tasks whose retention has run out (§5.6).
   * Run once at boot, which is the sweep §5.6 asks for: the window is measured
   * in weeks, so a daemon that is up for one has nothing to do in the meantime.
   *
   * **Archived tasks only.** A suspended task's `wip_ref` is not a grace
   * period, it is where its work is *stored* — expiring one would delete a
   * user's uncommitted changes on a timer, which is the one thing this design
   * exists never to do.
   *
   * `retentionMs` at or below zero keeps every ref forever, matching the way
   * the harvester's two tiers are turned off.
   *
   * Never throws: it runs on the boot path with nothing to hand a rejection to,
   * and a repository that has moved out from under one archived task is no
   * reason to leave the other twenty holding refs. */
  async expireArchivedWip(
    retentionMs = WIP_RETENTION_MS,
    now = Date.now(),
  ): Promise<number> {
    if (retentionMs <= 0) return 0;
    let archived: TaskRow[];
    try {
      archived = this.store.list({ lifecycle: "archived" });
    } catch (e) {
      // The listing itself, outside the per-task guard below, because the
      // caller fires this and never looks at the promise — the same shape the
      // harvester's sweeps use, and for the same reason.
      console.warn("Could not list archived tasks to expire their snapshots:", e);
      return 0;
    }
    let expired = 0;
    for (const row of archived) {
      if (!row.wip_ref || row.wip_at === null) continue;
      if (now - row.wip_at <= retentionMs) continue;
      try {
        const repoRoot = await this.repoRootFor(row);
        // Without a repository there is no ref store to delete from. The row
        // keeps saying what it says, which is the honest state: the snapshot
        // may well still exist somewhere nothing can name.
        if (!repoRoot) continue;
        // Checked after the await above, which is where an unarchive could have
        // started: it has already read this ref and planned the branch around
        // it, and dropping it now would have it recreate the branch at the
        // snapshot's parent and then restore none of the work it was for.
        if (this.inflight.unarchiving.has(row.id)) continue;
        await dropWip(repoRoot, row.id);
        if (this.store.get(row.id)) {
          // `wip_at` is kept, and it is the only record that there was ever a
          // snapshot to lose. The unarchive preview reads "the row says one was
          // taken and git has none" as expired — the difference between telling
          // the user their uncommitted work is gone and telling them there was
          // never any. Nothing else reads `wip_at` without `wip_ref`.
          this.store.update(row.id, { wip_ref: null });
        }
        expired++;
      } catch (e) {
        console.warn(`Could not expire the WIP snapshot of archived task ${row.id}:`, e);
      }
    }
    return expired;
  }

  /** What unarchiving this task would restore, before it is confirmed
   * (TASK-139).
   *
   * Null unless the row is archived — the route has already answered 404 for a
   * task that is not there, so null here is the 409. The same `planUnarchive`
   * the act runs, so the dialog cannot promise one thing and the button do
   * another for any reason except time passing between them.
   *
   * Throws `WorktreeError` when the plan cannot be made at all: a repository
   * nobody can name any more (`repo-unknown`), or a deleted branch with nothing
   * to recreate it from (`bad-base-ref`). */
  async unarchivePreview(taskId: string): Promise<UnarchivePreview | null> {
    const row = this.store.get(taskId);
    if (!row || row.lifecycle !== "archived") return null;
    return (await this.planUnarchive(row)).preview;
  }

  /** How an archived task's checkout comes back, read from git rather than from
   * the row: the archive may have deleted the branch, the sweep may have
   * dropped the snapshot, and the user may have done either by hand since.
   *
   * The ladder is ordered by how much of the task's work each rung keeps. A
   * branch that is still there keeps all of it. A snapshot's parent is the
   * exact commit the work was sitting on — recreating the branch there makes
   * HEAD equal `wip.parent`, so the restore's own guard passes and the snapshot
   * applies, which is the whole of what a snapshot is for. A remote copy keeps
   * the commits but not the dirt; the base ref keeps neither, and is offered
   * only so that the task can be opened at all. */
  private async planUnarchive(row: TaskRow): Promise<UnarchivePlan> {
    const named = { branch: row.branch, baseRef: row.base_ref };
    if (row.worktree_state === "none" || !row.branch) {
      return {
        preview: { checkout: "none", snapshot: { state: "none" }, ...named },
        repoRoot: null,
        recreateAt: null,
      };
    }
    const repoRoot = await this.repoRootFor(row);
    if (!repoRoot) {
      // The restore would throw exactly this a moment later — after the row had
      // been flipped out of `archived` — so the plan throws it first, while
      // refusing still changes nothing.
      throw new WorktreeError(
        "repo-unknown",
        `Task "${row.title}" was branched from a repository this task can no longer name — `
          + `its project was removed.`,
      );
    }
    const [wip, tip] = await Promise.all([
      readWip(repoRoot, row.id),
      resolveCommit(repoRoot, `refs/heads/${row.branch}`),
    ]);

    let snapshot: UnarchiveSnapshot;
    if (wip) {
      snapshot = {
        state: "kept",
        expiresAt: row.wip_at === null ? null : row.wip_at + WIP_RETENTION_MS,
        // The restore's guard, asked ahead of it. Only meaningful for a branch
        // that is still there: a recreated one is put at `wip.parent` below.
        stale: tip !== null && tip !== wip.parent,
      };
    } else if (row.wip_ref !== null || row.wip_at !== null) {
      snapshot = {
        state: "expired",
        expiredAt: row.wip_at === null ? null : row.wip_at + WIP_RETENTION_MS,
      };
    } else {
      snapshot = { state: "none" };
    }

    const plan = (checkout: UnarchiveCheckout, recreateAt: string | null): UnarchivePlan => ({
      preview: { checkout, snapshot, ...named },
      repoRoot,
      recreateAt,
    });
    if (tip) return plan("restore", null);
    if (wip) return plan("from-snapshot", wip.parent);
    const remote = await resolveCommit(repoRoot, `refs/remotes/origin/${row.branch}`);
    if (remote) return plan("from-remote", remote);
    // `HEAD` when the row has no base ref, which is what a create with none
    // branched from.
    const base = await resolveCommit(repoRoot, row.base_ref ?? "HEAD");
    if (!base) {
      throw new WorktreeError(
        "bad-base-ref",
        `The branch ${row.branch} is gone, and its base ${row.base_ref ?? "HEAD"} `
          + `no longer names a commit to recreate it from`,
      );
    }
    return plan("from-base", base);
  }

  /** Bring an archived task back: its checkout on its branch, the snapshot's
   * uncommitted work applied, and its agent resumed (TASK-139).
   *
   * Null for a task that is not there; `NotArchivedError` for one that is not
   * archived. Otherwise the resumed row — or undefined, as `resumeTask` answers
   * for a task deleted under the ladder.
   *
   * Three steps, and only the first is new:
   *
   * 1. **Put a deleted branch back**, at the commit `planUnarchive` chose. A
   *    failure here throws with the row still archived and nothing changed.
   * 2. **Flip the row to `suspended`**, keeping `worktree_state = evicted` — an
   *    archived task with a checkout is exactly an evicted one whose checkout
   *    has not been rebuilt yet, which is the state the resume ladder already
   *    knows how to open.
   * 3. **Resume through the ordinary door.** `runResumeLadder` restores the
   *    checkout via `restoreTaskWorktree` (applying the snapshot when the
   *    branch is where it was taken), regenerates `~/.codetoaster/tasks/<id>/`
   *    — `spawnAgent` writes the settings file on every spawn and the setup
   *    stamp's wrapper makes its own directory — and walks the agent's ladder.
   *
   * A failure after step 2 — a restore git refused, an agent that would not
   * come back — leaves the task suspended and evicted, with the branch and the
   * snapshot both intact. That is deliberate, and it is safe: it is the
   * ordinary state of an evicted task, the user can open it again from the
   * live list, and nothing has been lost. Flipping it back to `archived` would
   * be worse — the retention sweep only expires archived tasks' snapshots, so
   * putting the row back there is what would put the work on a timer again. */
  async unarchiveTask(
    taskId: string,
    size: { cols?: number; rows?: number } = {},
  ): Promise<TaskRow | undefined | null> {
    // An archive in flight settles first, and then this starts over against
    // the row it left — archived, which is what this is for. `archiveTask`
    // waits on this map before registering in its own, and this waits on its
    // map before registering here, so the two can never wait on each other.
    const archiveInFlight = this.inflight.archiving.get(taskId);
    if (archiveInFlight) {
      await archiveInFlight.catch(() => undefined);
      return this.unarchiveTask(taskId, size);
    }
    // Two browsers confirming the same dialog: the second joins the first
    // rather than racing it to recreate the branch. Before the resume wait
    // below, because the first unarchive's own resume is in `resuming` — a
    // second caller waiting on that would then find the row live and answer 409
    // to a request the first one is in the middle of granting.
    const already = this.inflight.unarchiving.get(taskId);
    if (already) return already;
    // An eviction or a resume cannot be running on an archived row — evict
    // refuses anything not suspended, resume refuses archived — so either one
    // in flight means the row is not archived, and the answer will be
    // `NotArchivedError`. Waited on all the same, so that answer is given
    // about the row they leave rather than the one they are changing.
    const evictInFlight = this.inflight.evicting.get(taskId);
    if (evictInFlight) {
      await evictInFlight.catch(() => undefined);
      return this.unarchiveTask(taskId, size);
    }
    const resumeInFlight = this.inflight.resuming.get(taskId);
    if (resumeInFlight) {
      await resumeInFlight.catch(() => undefined);
      return this.unarchiveTask(taskId, size);
    }
    // Registered before the first await, so an archive or a second unarchive
    // that checks this map cannot slip past between the guards and the work.
    const attempt = this.doUnarchive(taskId, size).finally(() => {
      this.inflight.unarchiving.delete(taskId);
    });
    this.inflight.unarchiving.set(taskId, attempt);
    return attempt;
  }

  private async doUnarchive(
    taskId: string,
    size: { cols?: number; rows?: number },
  ): Promise<TaskRow | undefined | null> {
    const row = this.store.get(taskId);
    if (!row) return null;
    if (row.lifecycle !== "archived") throw new NotArchivedError(taskId);

    const plan = await this.planUnarchive(row);
    if (plan.recreateAt && plan.repoRoot && row.branch) {
      const repoRoot = plan.repoRoot;
      const branch = row.branch;
      const commit = plan.recreateAt;
      await withRepoLock(await lockKeyFor(repoRoot), () => recreateBranch(repoRoot, branch, commit));
    }

    // Deleted while git was working: nothing to bring back. The recreated
    // branch stays, which is the harmless half — `deleteTask` had already run
    // its own branch decision against a repository without it.
    if (!this.store.get(taskId)) return null;
    // Ranked as it flips: the user just asked for this task, and a resume that
    // lands on could-not-resume (or a restore that throws) never reaches the
    // ladder's own `stampRank`, which would leave the task at its pre-archive
    // rank — weeks down the list it was supposed to return to the top of.
    this.stampRank(taskId, Date.now(), { lifecycle: "suspended" });
    this.ensureInProject(taskId);
    // The whole list, as archive does in the other direction: the task joins
    // `listTasks`, and every attached client has to learn it is there before
    // the ladder's own deltas about it start arriving.
    this.broadcastTasks();
    // No await between the flip and this call's registration in `resuming`:
    // `resumeTask` runs synchronously until it has registered, so nothing can
    // see the row suspended-and-evicted without also seeing the resume.
    return this.resumeTask(taskId, size);
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

  /** Hard delete: the row, the terminals, the checkout, the snapshot and the
   * task's directory go for good, and the id can never be reissued. The one
   * irreversible operation in the design (§5.6).
   *
   * The difference from archive is what is *not* kept. Archive keeps the row
   * behind `lifecycle = archived` and keeps the WIP ref for its retention
   * window, so the work is recoverable; this drops both. It is reached from
   * `DELETE /api/tasks/:id` — the CLI's `codetoaster kill`, which meant delete
   * in v1 and has no other route to mean it by — and from the browser only
   * through a confirmation of its own.
   *
   * The branch is the exception, and follows archive's rule rather than this
   * one's: it is deleted only when its commits survive the deletion — merged
   * into `base_ref`, or on a remote. "The user asked to forget this task" is
   * not the same statement as "the user asked to lose these commits", and a ref
   * left behind under `codetoaster/` costs nothing and is one refspec to
   * remove.
   *
   * The row goes **synchronously**, before any of the git. Several writes
   * elsewhere re-read the store on the far side of an await specifically to
   * notice a task deleted underneath them, and doing the cleanup first would
   * widen that window from nothing to however long `git worktree remove` takes.
   * The promise this answers with covers the cleanup, so a caller that cares —
   * a test tearing down a real checkout — can wait for it, and one that does
   * not can drop it: nothing below the row removal is allowed to throw.
   *
   * Null means there was no such task. An outcome means it is gone, and says
   * what became of its branch. */
  async deleteTask(taskId: string): Promise<DeleteOutcome | null> {
    const row = this.store.get(taskId);
    if (!row) return null;
    // Fired rather than awaited: an unlink that fails — a directory already
    // removed by hand, a read-only home — must not be allowed to fail the
    // removal of a task that is otherwise gone. `purge` takes the whole
    // directory below, and this is the one file worth not waiting for.
    void removeSnapshot(taskId).catch(() => {});
    // Before the row goes: a timer that outlived its task would wake up to
    // relabel something that is no longer there.
    this.disarmHookGrace(taskId);
    this.hooks.forgetAgentProcess(taskId);
    this.terminals.cwdCheckedAt.delete(taskId);
    this.clearRestarted(taskId);
    // Normally spent by the first hook. A task deleted before its agent ever
    // reported one never spends it, and without this the map keeps an entry
    // per such task for the life of the daemon.
    this.clearSpawnedAt(taskId);
    // Unmapped before the kills, so a mid-burst PTY's kill-time edge cannot
    // stamp or announce a task about to be dropped; an agent killed mid-burst
    // still gets its bare falling edge, or a client would hold the task as
    // active for as long as it held the task at all.
    this.unmapAndKill(taskId, [...(this.terminals.taskPtys.get(taskId) ?? [])]);
    this.activity.rankAt.delete(taskId);
    this.terminals.taskPtys.delete(taskId);
    this.terminals.agentPtys.delete(taskId);
    this.store.delete(taskId);
    for (const project of this.projects) {
      const idx = project.taskIds.indexOf(taskId);
      if (idx !== -1) {
        project.taskIds.splice(idx, 1);
        break;
      }
    }
    return await this.purge(row);
  }

  /** Everything a deleted task leaves on disk, taken with it (TASK-64): the
   * checkout under `~/.codetoaster/worktrees/`, git's registration of it, the
   * `codetoaster/<slug>` branch when its commits survive elsewhere, the WIP ref,
   * and `~/.codetoaster/tasks/<id>/`. Without this, `codetoaster kill` on a task
   * with a worktree stranded all five, and nothing would ever name them again.
   *
   * Takes the row it was handed rather than reading one, because the row is
   * already gone by the time this runs — which is also why it resolves the
   * repository through `resolveRepoRoot`, the variant that does not write its
   * answer back.
   *
   * Never throws. It runs after the task has been removed from every list a
   * caller can see, so there is nobody left to report a failure to and nothing
   * a failure could be retried against; what is left is a warning and some
   * files. */
  private async purge(row: TaskRow): Promise<DeleteOutcome> {
    const outcome: DeleteOutcome = { branch: row.branch, branchDeleted: false, branchKept: null };
    try {
      const repoRoot = row.worktree_state === "none" ? null : await this.resolveRepoRoot(row);
      if (repoRoot) {
        if (row.worktree_path) await evictWorktree(repoRoot, row.worktree_path);
        if (row.branch) {
          const status = await branchStatus(repoRoot, {
            branch: row.branch,
            baseRef: row.base_ref,
            // The checkout is gone by now, and `dirty` is not a question this
            // path asks: nothing here is shown to a user, and the only thing
            // being decided is whether the branch's commits exist elsewhere.
            worktreePath: null,
          });
          if (!status.exists) {
            outcome.branch = null;
          } else if (branchIsExpendable(status)) {
            outcome.branchDeleted = await deleteBranch(repoRoot, row.branch);
            if (!outcome.branchDeleted) outcome.branchKept = `git would not delete ${row.branch}`;
          } else {
            outcome.branchKept = keptReason(row.branch, row.base_ref, status);
          }
        }
        // After the branch, not before: the ref is the last thing keeping the
        // snapshot's objects reachable, and a delete that failed part-way is
        // better off having kept it.
        if (row.wip_ref) await dropWip(repoRoot, row.id);
      }
    } catch (e) {
      console.warn(`Could not clean up after deleting task ${row.id}:`, e);
    }
    await removeTaskDir(row.id);
    return outcome;
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
