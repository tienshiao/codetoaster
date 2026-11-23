// What the src/lib/tasks modules see of TaskManager (TASK-152).
//
// TaskManager is the one entry point, and each concern split out of it is a
// class holding a `TaskHost`. The manager passes itself: the host *is* the
// manager instance, typed down to the members the modules use. Members that
// were private on it are widened and marked `@internal`, rather than handed
// over as an object of closures, because the tests replace methods on the
// instance (`snapshot`, `snapshotTaskWip`, `restoreTaskWorktree`, `liveTasks`,
// `suspendedTasks`, `refreshStaleWorktreeStatuses`) and expect internal callers
// to hit the replacement. A call through `this.host` is looked up on the
// instance at the moment it is made, so it does; a closure bound at
// construction would quietly keep calling the original.
//
// The same goes for state that is reassigned after construction — `store` and
// `db` (the database can be swapped), `profiles` (`setProfiles`): a module
// reads them through the host at each use and never keeps a copy.
//
// Imported with `import type` everywhere, so no module depends on manager.ts at
// runtime.

import type { Database } from "bun:sqlite";
import type { ProfileRegistry } from "../agent/profiles";
import type { TaskRow } from "../db";
import type { RestoredWorktree, UnclaimedWorktree } from "../worktree";
import type { Pty } from "../xtmux/pty";
import type { SpawnOptions } from "../xtmux/pty-manager";
import type { ProjectInfo, ServerMessage, TaskInfo, TaskWorktreeInfo } from "../xtmux/types";
import type { CreateTaskOptions } from "./manager";
import type { TaskStore, TaskUpdate } from "./store";

export interface TaskHost {
  readonly db: Database;
  readonly store: TaskStore;
  readonly profiles: ProfileRegistry;

  // Projects (projects.ts)
  readonly projects: ProjectInfo[];
  getProjects(): ProjectInfo[];
  rankedProjects(): ProjectInfo[];
  ensureInProject(taskId: string): void;
  resolveProjectId(options: CreateTaskOptions): string;
  placeInProject(taskId: string, projectId: string, options: CreateTaskOptions): void;

  // Clients and broadcasting (clients.ts)
  broadcastToAll(message: object): void;
  tasksSnapshot(): ServerMessage;
  broadcastTasks(): void;
  broadcastTask(taskId: string): void;
  clientCount(): number;

  // Checkout watchers (checkout-watchers.ts)
  reconcileWatchers(): void;
  reconcileWatcher(row: TaskRow): void;
  stopWatcher(taskId: string): void;

  // Checkout status (worktree-status.ts)
  refreshWorktreeStatus(taskId: string, options?: { force?: boolean }): Promise<void>;
  refreshStaleWorktreeStatuses(): Promise<void>;
  worktreeStatusOf(taskId: string): TaskWorktreeInfo | undefined;

  // Boot reconciliation (boot.ts)
  getUnclaimedWorktrees(): UnclaimedWorktree[];

  // Worktrees
  repoRootFor(row: TaskRow): Promise<string | null>;

  // Where a task's processes report back to (`setPort`)
  readonly port?: number;
  readonly origin?: string;

  // Terminals (terminals.ts)
  getClientPtyIds(clientId: string): string[];
  primaryPty(taskId: string): Pty | undefined;
  shellPtys(taskId: string): Pty[];
  taskIdForPty(ptyId: string): string | undefined;
  refreshCwdIfStale(taskId: string, maxAgeMs?: number): Promise<string | undefined>;
  refreshCwd(taskId: string): Promise<string | undefined>;
  spawnPty(command: string[], options: SpawnOptions): Pty;
  adopt(pty: Pty, taskId: string): void;
  agentPtyId(taskId: string): string | undefined;
  forgetAgentPty(taskId: string): void;
  unmapAndKill(taskId: string, ptyIds: readonly string[]): void;

  // Activity, rank and degraded-mode inference (activity.ts)
  stampActivity(
    taskId: string,
    ptyId: string,
    active: boolean,
    now: number,
    rank: boolean,
  ): { rankAt?: number; longGap: boolean };
  wakeOnInput(ptyId: string, data: string): void;
  inferState(taskId: string, active: boolean): void;
  seedOutputEdge(ptyId: string, at: number): void;
  forgetOutputEdge(ptyId: string): void;
  stampRank(taskId: string, at: number, extra?: TaskUpdate): TaskRow | undefined;
  armHookGrace(taskId: string): void;
  disarmHookGrace(taskId: string): void;

  // Hooks (hooks.ts)
  hasSeenHook(taskId: string): boolean;
  forgetAgentProcess(taskId: string): void;

  // Resume (resume.ts)
  resumeTask(
    taskId: string,
    options?: { fresh?: boolean; cols?: number; rows?: number },
  ): Promise<TaskRow | undefined>;
  recordSetupOutcome(taskId: string): Promise<void>;
  setSpawnedAt(taskId: string, at: number): void;
  clearSpawnedAt(taskId: string): void;
  clearRestarted(taskId: string): void;

  // Suspend, evict and WIP
  restoreTaskWorktree(taskId: string): Promise<RestoredWorktree | null>;

  // The TaskInfo projection (task-info.ts)
  taskInfo(taskId: string): TaskInfo | undefined;
  listTasks(): TaskInfo[];
  taskTitles(): string[];

  // Lifecycle state the projection reads
  isRestarted(taskId: string): boolean;
  isEvicting(taskId: string): boolean;
  isArchiving(taskId: string): boolean;
}
