---
type: Module
title: TaskManager layout
description: TaskManager is the one entry point for tasks, a facade of non-async delegators over one class per concern in src/lib/tasks; the modules reach each other through a TaskHost that is the manager instance itself, and the five in-flight maps that serialize resume, suspend, evict, archive and unarchive live together in inflight.ts.
tags: [module, tasks, lifecycle, architecture]
level: project
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-23T16:59:19Z }
sources:
  - id: manager
    resource: ../../src/lib/tasks/manager.ts
    title: src/lib/tasks/manager.ts
  - id: host
    resource: ../../src/lib/tasks/host.ts
    title: src/lib/tasks/host.ts
  - id: inflight
    resource: ../../src/lib/tasks/inflight.ts
    title: src/lib/tasks/inflight.ts
  - id: pairs
    resource: ../../src/lib/tasks/lifecycle-pairs.test.ts
    title: src/lib/tasks/lifecycle-pairs.test.ts
  - id: task-152
    resource: "../../backlog/tasks/task-152 - Split-TaskManager-into-focused-modules.md"
    title: "TASK-152 — Split TaskManager into focused modules"
---

# Shape

`TaskManager` (`src/lib/tasks/manager.ts`) is the only way into tasks. `server.ts`, the routes in `src/api`, the socket handlers in `lib/xtmux/client-messages.ts`, the harvester and the CLI all call it, and none of the modules below. (They still import the standalone helpers `store.ts`, `snapshot.ts`, `watch-pool.ts` and `harvester.ts` directly.) It owns the database handle, the `TaskStore`, the profile registry and the server's port and origin. Every public method is a one-line delegator into the module that holds the concern.[^manager]

Until TASK-152 it was one class of about 4,450 lines. Every task feature had landed on it as methods and state.[^task-152]

| Module | Class | Holds |
| --- | --- | --- |
| `projects.ts` | `ProjectRegistry` | Projects, their settings, sidebar order, and which project a task is in |
| `clients.ts` | `ClientRegistry` | Connected sockets and broadcasting (`tasks` snapshots, `task` rows) |
| `checkout-watchers.ts` | `CheckoutWatchers` | One checkout watcher per live task while a browser is connected ([change watcher](/modules/change-watcher.md)) |
| `worktree-status.ts` | `WorktreeStatusCache` | What git last said about each task's checkout, for its card |
| `boot.ts` | `BootReconciler` | Boot-time reconciliation, and the unclaimed worktrees it finds |
| `task-info.ts` | `TaskInfoProjection` | The `TaskInfo` each client is sent, and the task lists |
| `terminals.ts` | `TaskTerminals` | The PTYs: which belong to which task, which one is the agent, shell tabs, client attach and input, the live cwd |
| `activity.ts` | `TaskActivity` | Output edges, `rank_at`, the hook grace timer and the degraded-mode busy/idle inference ([task list order](/modules/task-list-order.md)) |
| `hooks.ts` | `TaskHooks` | `applyHook`, which tasks have reported a hook, and compaction state |
| `create.ts` | `TaskCreation` | `createTask` |
| `resume.ts` | `TaskResumption` | Spawning the agent, waiting for it to start, and the resume ladder |
| `suspend.ts` | `TaskSuspension` | Snapshots, suspend and harvest, eviction, WIP snapshots and checkout restore ([task suspension](/modules/task-suspension.md)) |
| `archive.ts` | `TaskArchive` | Archive, unarchive, WIP expiry and hard delete ([archive and unarchive](/modules/archive-and-unarchive.md)) |
| `inflight.ts` | `InFlight` | The five in-flight maps, and nothing else |

The helpers that were already separate are unchanged: `store.ts`, `derive.ts`, `snapshot.ts`, `watcher.ts`, `watch-pool.ts`, `harvester.ts`.

# The host

Each module takes a `TaskHost` (`host.ts`), the interface of what modules may use of each other. The manager passes itself: `class TaskManager implements TaskHost`. Members that were private and are now needed across modules are marked `@internal`.[^host]

That choice is load-bearing, and the rules that follow from it are how the split stays behaviour-preserving:

- **A call to a method that was public on TaskManager before the split goes through `this.host`, even inside one module.** Tests replace methods on the instance (`snapshot`, `snapshotTaskWip`, `restoreTaskWorktree`, `liveTasks`, `suspendedTasks`, `refreshStaleWorktreeStatuses`) and expect the lifecycle paths to call the replacement. A lookup on the instance at call time does; a closure bound at construction would keep calling the original.[^host] Members that were private and are on the host only for other modules (`@internal`) are called directly by the module that owns them: `stampRank` in activity, `stopWatcher` and `reconcileWatcher` in checkout-watchers, `adopt` and `unmapAndKill` in terminals. `openShell`'s `adopt(pty, taskId, false)` cannot go through the host, whose `adopt` takes no `agent` flag.
- **Reassignable state is read through the host at each use, never captured.** The database can be swapped, `setProfiles` replaces the registry, and `setPort` sets the port and origin.[^host] The `set*` timing knobs are not on the host: each is a field of the module that reads it, and the facade's setter writes it there.
- **Facade delegators are not `async`.** An async wrapper adds microtask ticks, which can reorder the concurrent lifecycle calls below.[^manager]
- **State has one owner.** Another module reaches it through a narrow host method rather than the field. For example `seedOutputEdge` / `forgetOutputEdge` (activity), `forgetAgentProcess` (hooks), `setSpawnedAt` / `clearSpawnedAt` / `clearRestarted` (resume), `forgetTaskPtys` (terminals). Each clear site in suspend and delete calls them in the same order it used to clear the fields.
- **Modules import the host with `import type`**, so no module depends on manager.ts at runtime. A constant a module needs at runtime is declared in that module and re-exported from manager.ts: `RERANK_QUIET_MS` (activity), and `WIP_RETENTION_MS` and `NotArchivedError` (archive).

# In-flight operations

Resume, suspend (close or harvest), evict, archive and unarchive are all awaited, multi-step operations on one task. Each registers a promise per task in its map on `InFlight`, and every lifecycle module holds the same instance. Each operation then does one of three things when it finds another in flight: **join** it, **wait** it out and start over against the row it leaves, or **refuse** at the door. Each side waits before it registers, so two operations can never wait on each other.[^inflight]

| Arriving \ In flight | resume | suspend | evict | archive | unarchive |
| --- | --- | --- | --- | --- | --- |
| **resume** | join (a `fresh` start waits) | wait | wait | wait, then refused (archived) | — |
| **suspend** | wait | join (a close behind a harvest waits) | — | — | — |
| **evict** | refuse | — | join | refuse | refuse |
| **archive** | wait | (suspends through `suspendTask`) | wait | join | wait |
| **unarchive** | wait, then `NotArchivedError` | — | wait, then `NotArchivedError` | wait | join |

The wait-then-register code is written out in each operation's own method, deliberately, with no shared lock helper: each pairing has its own reason, and the comments beside each wait give it. Each pairing in the table has a test, in `lifecycle-pairs.test.ts` or beside its operation in the resume, worktree, archive, unarchive and harvester tests.[^pairs]

Evict's refusal during an unarchive has no test that fails without it. `doEvict` refuses an archived or not-yet-restored row anyway, so the refusal at the door only says so earlier.[^task-152]

[^manager]: src/lib/tasks/manager.ts
[^host]: src/lib/tasks/host.ts
[^inflight]: src/lib/tasks/inflight.ts
[^pairs]: src/lib/tasks/lifecycle-pairs.test.ts
[^task-152]: TASK-152 — Split TaskManager into focused modules
