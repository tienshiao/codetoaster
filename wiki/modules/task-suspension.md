---
type: Module
title: Task suspension and the idle harvester
description: A task's processes are killed and its row marked suspended when the daemon restarts, when the user suspends it, or when the idle harvester finds it idle for 30 minutes with nobody watching and nothing running; a turn that ended with background work still running is held for up to 4 hours.
tags: [module, tasks, harvester, suspend, hooks, agent-state]
level: project
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-23T16:59:19Z }
sources:
  - id: harvester
    resource: ../../src/lib/tasks/harvester.ts
    title: src/lib/tasks/harvester.ts
  - id: hook-state
    resource: ../../src/lib/agent/hook-state.ts
    title: src/lib/agent/hook-state.ts
  - id: settings
    resource: ../../src/lib/agent/settings.ts
    title: src/lib/agent/settings.ts
  - id: server
    resource: ../../src/server.ts
    title: src/server.ts
  - id: task-145
    resource: "../../backlog/tasks/task-145 - Do-not-harvest-a-task-while-its-agent-has-background-work-running.md"
    title: "TASK-145 — Do not harvest a task while its agent has background work running"
---

# What suspension is

Suspending a task snapshots its agent terminal's screen to disk, kills every terminal the task holds, and leaves the row `lifecycle: suspended`. The row, the checkout and the task directory stay; opening the task resumes the conversation with `claude --resume`, showing the snapshot while it comes back. Anything that was running inside those processes is gone, including background agents and background shells the agent had launched.[^harvester]

# The three ways in

- **Daemon restart.** Every `live` row is wrong at boot, because the PTYs died with the previous process, so `reconcileOnBoot` marks them all suspended (`agent_state: unknown`).[^server]
- **Manual suspend** from the command palette (`closeTask` → `suspendTask`). It carries none of the harvester's guards; the palette asks first when the task's state is `busy` or `background`.
- **The idle harvester**, below.

# The idle harvester

A 30-second tick over the live tasks. A task is harvested only when every guard holds, each one asked again just before the kill:[^harvester]

- the row is `live`;
- `agent_state` is `idle` and `idle_since` is older than `harvestAfterMs` (30 minutes by default; `--harvest-after` or `CODETOASTER_HARVEST_AFTER`, `0` turns it off), **or** `agent_state` is `background` and `idle_since` is older than `max(backgroundAfterMs, harvestAfterMs)` (4 hours by default);
- no client is attached to any of the task's terminals. A browser showing some *other* task counts as nobody;
- none of the task's terminals has a foreground process other than its own program (`hasForegroundProcess`; an unanswerable terminal counts as busy).

A null `idle_since` never passes: a task nobody saw stop is not idle since forever.

# Where `idle` and `background` come from

Every agent is launched with `--settings` pointing at a per-task file of hooks (`SessionStart`, `UserPromptSubmit`, `Stop`, `Notification`, `SessionEnd`, `PreCompact`), all running `codetoaster hook`, which posts the payload untouched to `/api/tasks/:id/hook`. `transitionFor` maps each payload to a row change.[^settings] [^hook-state]

`Stop` fires when the agent's *turn* ends, not when its work does. A background subagent, background shell, monitor or workflow the turn launched keeps running inside the same `claude` process, where the foreground-process guard cannot see it. Claude Code lists that outstanding work in the `Stop` payload's `background_tasks` (running and pending entries only), so a `Stop` with a non-empty list maps to `agent_state: background` instead of `idle`. `idle_since` is stamped either way; for `background` it is what the 4-hour cap counts from.[^task-145]

When the background work finishes, Claude Code hands its result to the agent as a new turn: a `UserPromptSubmit` (busy) and then a `Stop` with an empty list (idle, `idle_since` restamped). The ordinary 30-minute window then counts from when the work was really done. This was observed on Claude Code 2.1.330; a version without the field reads as nothing outstanding, which is the old behaviour.

A `/compact` typed while the task is `background` would otherwise come back `idle`, since nothing in the compaction's `SessionStart` mentions background work. So the manager remembers, across the compaction, that it started from `background` (`compactingFromBackground`, beside `compactTriggers` in `src/lib/tasks/hooks.ts`) and restores it.

Suspend, harvest and eviction run in `src/lib/tasks/suspend.ts`, behind `TaskManager`'s `suspendTask`, `harvestTask` and `evictTask` ([TaskManager layout](/modules/task-manager-layout.md)).

The cap exists because `background` rests on one payload: a background dev server or monitor never finishes, and a completion that was never reported would otherwise pin the task live for good.

# In the UI

`taskStateOf` maps `background` to its own `TaskState`, drawn as busy's colour without the pulse and labelled "background" in the row tooltip and hover card, so a task whose agent is waiting on background work reads differently from one that is done.

[^harvester]: src/lib/tasks/harvester.ts
[^hook-state]: src/lib/agent/hook-state.ts
[^settings]: src/lib/agent/settings.ts
[^server]: src/server.ts
[^task-145]: TASK-145 — Do not harvest a task while its agent has background work running
