---
id: TASK-27
title: Extra shell tabs inside a task
status: Done
assignee:
  - '@claude'
created_date: '2026-08-29 00:03'
updated_date: '2026-08-30 22:53'
labels:
  - frontend
  - server
  - tasks
milestone: m-3
dependencies:
  - TASK-22
  - TASK-4
documentation:
  - docs/v2-architecture.md
ordinal: 27000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Open a plain shell PTY as a sibling tab in a task (§3, §5.5). Shell PTYs spawn at the task cwd, are owned by the task (killed on harvest), and are not resumable. On reopening a suspended task decide the policy in the UI, not silently: respawn shell tabs empty at the task cwd or drop them from the layout.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A 'new shell' action spawns a shell PTY at the task cwd and opens it as a closable tab
- [x] #2 Harvesting or closing the task kills its shell PTYs
- [x] #3 The harvester's foreground-process guard considers every shell PTY of the task
- [x] #4 Reopening a suspended task applies a visible, documented policy for stale shell tabs (respawn empty or drop)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. **Split the agent PTY from the task's PTY set** (`lib/tasks/manager.ts`). `adopt` currently wires agent semantics — onExit → `agent_state: exited`, onTitleChange → the task's `terminalTitle`, onActivityChange → degraded-mode state inference, onNotification — onto whatever PTY it is handed. A shell must own none of those. Split into `adopt(pty, taskId, { agent })`: ownership (`ptyToTask`, `taskPtys`) for both, agent callbacks only for the agent. A shell's exit and activity bump recency and rebroadcast the row; they never speak for the agent.

2. **Track the agent PTY explicitly** (`agentPtys: Map<taskId, ptyId>`) and read `primaryPty` off it. Today it returns the first live PTY in an insertion-ordered set, which is the agent only by luck: `resumeTask` on a live task (an agent that exited, or `fresh: true`) calls `discardPty` and then adopts the new agent *after* the shells — so `primaryPty` would answer with a shell, and `taskInfo.ptyId`, `snapshot`, `refreshCwd` and resume's own already-running test would all follow it. Cleared by `discardPty`, `doSuspend` and `deleteTask`.

3. **`TaskManager.openShell(taskId, { cols, rows })`**: refuse unless the task is live; spawn `[$SHELL || /bin/sh]` at the task's cwd with the same `taskEnv` scrub the agent gets (a shell that runs `claude` by hand must not inherit the marker); adopt as non-agent; broadcast. `closeShell(taskId, ptyId)` kills one, refusing to kill the agent through the shell door.

4. **Routes**: `POST /api/tasks/:id/shell` → `{ ptyId, task }`; `DELETE /api/tasks/:id/shell/:ptyId`. 404 on an unknown task or PTY, 409 on a suspended task.

5. **`TaskInfo.shellPtyIds: string[]`** on the wire — what lets a client reconcile a restored layout against what is actually running.

6. **`ShellPane`** (`components/tabs/panes/`): AgentPane minus the two-phase reopen — attach to the descriptor's ptyId, report size while visible, stop while hidden. `TabPane`'s `shell` case stops being a placeholder.

7. **New-shell affordance**: `onNewShell` on `v2/TabStrip` (a Plus in the action cluster) → `TabArea` → `TaskShell`, which POSTs and opens `{ kind: 'shell', ptyId }` in the active group. Closing a shell tab DELETEs its PTY (a new `onCloseTab` on `TabArea`, fired by the close gesture only — the prune path's PTYs are already dead).

8. **Stale shell tabs on reopen (AC#4): drop them, and say so.** `pruneShellTabs` already exists for this and already documents why it cannot run on load. It fires on positive knowledge only, never on absence: (a) the task is not `live`, which means it holds no PTYs at all — this is the reopen case, and it survives a page reload across a suspend; (b) within a live task, a ptyId this client has seen the server call live and that has since disappeared. A shell just opened has been seen by neither rule, so a stale delta racing the POST cannot delete the tab the user just opened. A toast names what was closed and why. §5.5 is amended from 'a choice worth making' to the choice that was made.

9. **Tests**: manager — a shell's exit leaves `agent_state` alone, a shell's title is not the task's, `primaryPty` survives a resume with a shell open (regression against step 2), suspend kills shells, `shellPtyIds`; harvester — a shell holding a foreground process blocks the harvest, and so does a view attached to one (AC#3); routes — open/close, and the refusals; layout-store — the two prune rules.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Build against `frontend/components/v2/` — the v2 design system is the new UI, not a parallel track (CLAUDE.md, "The v2 design system is the new UI"). `AppShell` and the shell components already exist from TASK-46; this task supplies their data. Do not extend `components/ui/` (v1 shadcn) for new surfaces.

Landed as planned, with two findings the plan did not anticipate.

**`primaryPty` was a latent bug, not a refactor.** It answered with the first live PTY in the task's terminal set, which is the agent only by insertion order. `resumeTask` on a *live* task — an agent that exited while the daemon stayed up, or `fresh: true` — discards the agent and adopts its replacement after any shells, so from the first such resume the task's "agent" would have been a shell: the agent tab attaching to it, `snapshot` serializing it, `refreshCwd` asking it where the task is, and resume's already-running test answering about it. There is now an explicit `agentPtys` slot. The regression test in resume.test.ts was confirmed to fail against the old lookup and only that test.

**`adopt` wired agent semantics onto any PTY it was handed.** Exit → `agent_state: exited`; OSC title → the task's `terminalTitle`; output activity → the degraded-mode busy/idle inference; notifications. Every one of those is the task speaking about its conversation, and a shell has no standing to say any of it — typing `exit` in a shell tab would have put a tombstone on a live agent, and a shell's title would have renamed the task in the sidebar. Split into `adopt(pty, taskId, agent)` plus a much smaller `adoptShell`, which bumps recency and broadcasts on death and does nothing else. It deliberately emits no `activity` message either: activity is addressed to the task and the sidebar's dot is edge-triggered off it, so a shell and an agent both emitting would have a build finishing put out the light on an agent still mid-turn.

**AC#3 needed tests, not code.** `Harvester` already asked both guards over `taskPtyList`, which was written for this — but 'every PTY of the task' is not an assertion a single-terminal task can make, so neither guard had ever been exercised against a shell. Two tests now do, through the real `openShell`.

**AC#4, the policy: drop the stale tabs and say so.** Respawning them empty puts back N processes nobody asked for, and an empty shell at the task cwd keeps the shape of the workspace while losing everything that made it one. The rule is *drop on positive knowledge, never on absence* (`reconcileShellTabs`, pure and unit-tested): the task is not live (it holds no processes at all — this is what survives a page reload across a harvest), or a PTY it had reported is no longer reported. The `seen` set is what makes the second rule safe — a shell tab is opened from the POST response, which races the task deltas, and pruning on absence would let a delta computed a moment before the spawn close the tab the user just opened.

**A shell that exits on its own keeps its tab**, showing its exit code the way an agent whose process died does; `PtyManager` only forgets a PTY when something kills it, so the task goes on reporting it and closing the tab is what reaps it. Dropping the tab on the exit frame would take the exit code down with it, which is the one place the reason a shell died is written.

Validation: `bun run test` (706 unit + 62 render, 0 fail), `tsc --noEmit` clean. Driven end to end against an isolated daemon on port 4601 with a stand-in agent binary — a real `claude` in the working tree is not an acceptable side effect of a UI check. Confirmed in the browser: the strip's `+` opens a live shell at the task cwd carrying `CODETOASTER_TASK_ID` with the inherited Claude marker scrubbed; the agent's ptyId is unmoved; closing the tab reaps the PTY; suspending drops the shell tab with the toast, both while watching and across a reload with the layout restored from localStorage. Over HTTP: 409 on a suspended task, 404 for an unknown task, an unknown PTY, another task's PTY, and — deliberately — the task's own agent. No console errors.

Post-review (`/code-review --fix`). Three real defects, all in the client, all fixed and now pinned by a new `TaskShell.render.tsx` — each test confirmed to fail against the pre-fix code and pass after:

1. **`handleNewShell` wrote a layout it captured before an await.** Two presses on `+` inside one round trip started from the same snapshot, so the second write landed a layout that never held the first shell's tab — a PTY running with nothing on screen to close it and nothing to reap it short of the task being suspended. Every layout write now goes through an `applyLayout` that updates a ref synchronously, and the post-await write reads the ref and bails if the user has changed task under the round trip.
2. **A restored shell tab whose PTY died unobserved was never pruned.** The lifecycle rule needs the client to *see* the suspension; a daemon restart or a harvest while the browser was closed, followed by a resume from the CLI or another client, presents a `live` task whose dead ptyId is in neither `seen` nor `shellPtyIds`, so neither rule fired and the tab sat there forever attached to nothing. A tab restored from disk now seeds `seen` — nothing is in flight for a tab this client did not spawn, so its absence is evidence rather than silence. Third bullet added to §5.5. Deliberately once per task: seeding unconditionally would prune the tab a `+` press had just opened, which two of the new tests catch.
3. **The composer raced its own navigation.** `createTask` answered over HTTP and the composer navigated immediately, but the task only enters the list over the socket — so `t.$slug`'s `missing = loaded && !taskById(id)` could bounce the user straight back to `/` into a fresh composer, losing the prompt they had typed. `createTask` now upserts the returned row, the same upsert the socket delta already does.

Also: the composer was sending no `cols`/`rows`, so a task started there spawned at the 80×24 fallback and reflowed on first attach, while the sidebar's New task sent 120×30. Two doors, two different tasks; now one.

The review's fourth finding — `taskInfo` possibly undefined in the shell routes' responses — is not reachable: both handlers are synchronous, so nothing can interleave between `openShell`/`closeShell` and the `taskInfo` read. Left alone.

Re-verified in the browser after the fixes: the composer lands on its new task, a double press on `+` yields two shells server-side and two tabs in the strip, no console errors.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A task can now hold plain shells beside its agent (§3, §5.5).

Server: `TaskManager.openShell`/`closeShell` spawn and kill a $SHELL at the task cwd under the same env scrub the agent gets, adopted as owned-but-not-agent; `POST /api/tasks/:id/shell` and `DELETE /api/tasks/:id/shell/:ptyId` behind them; `TaskInfo.shellPtyIds` on the wire. The agent's terminal is tracked in its own slot rather than inferred from set order, and `adopt` no longer wires the task's agent semantics — exit, title, state inference, notifications — onto every PTY it is handed.

Client: a `ShellPane`, a `+` in the tab strip, and closing a shell tab kills its PTY. Stale shell tabs are dropped on reopen and the user is told, by a rule that acts only on positive knowledge that a PTY is gone.

Harvest and close already took every terminal of the task; the guards that decide whether to were already asked over all of them, and now have tests that say so. §5.5's open choice is closed in the doc.
<!-- SECTION:FINAL_SUMMARY:END -->
