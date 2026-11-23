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
import type { UnclaimedWorktree } from "../worktree";
import type { Pty } from "../xtmux/pty";
import type { ProjectInfo, ServerMessage, TaskInfo, TaskWorktreeInfo } from "../xtmux/types";
import type { TaskStore } from "./store";

export interface TaskHost {
  readonly db: Database;
  readonly store: TaskStore;
  readonly profiles: ProfileRegistry;

  // Projects (projects.ts)
  readonly projects: ProjectInfo[];
  getProjects(): ProjectInfo[];
  rankedProjects(): ProjectInfo[];
  ensureInProject(taskId: string): void;

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

  // Terminals
  getClientPtyIds(clientId: string): string[];
  primaryPty(taskId: string): Pty | undefined;
  shellPtys(taskId: string): Pty[];

  // The TaskInfo projection (task-info.ts)
  taskInfo(taskId: string): TaskInfo | undefined;
  listTasks(): TaskInfo[];

  // Lifecycle state the projection reads
  isRestarted(taskId: string): boolean;
  isEvicting(taskId: string): boolean;
  isArchiving(taskId: string): boolean;
}
