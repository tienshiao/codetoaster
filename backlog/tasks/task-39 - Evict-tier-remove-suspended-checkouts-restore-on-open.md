---
id: TASK-39
title: 'Evict tier: remove suspended checkouts, restore on open'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-29 00:17'
updated_date: '2026-08-31 07:44'
labels:
  - server
  - tasks
  - git
milestone: m-4
dependencies:
  - TASK-38
  - TASK-16
documentation:
  - docs/v2-architecture.md
priority: high
ordinal: 39000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
§5.6: the second harvest tier. Over suspended tasks with worktree_state=present, when grace has elapsed: snapshot WIP (always, dirty or not), git worktree remove --force + prune, worktree_state=evicted, broadcast. Grace = base (default 7 days, configurable, 0 = never) scaled by the task's setup_duration_ms; pinned tasks are exempt; a manual per-task and per-project evict exists. Opening an evicted (or missing) task runs restore (worktree add + WIP + setup) before claude --resume, behind the two-phase 'restoring workspace…' banner from task-17. Eviction only runs on suspended tasks, so the harvester's process guards are already discharged.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A suspended, unpinned task past its grace is evicted: WIP ref written, directory removed, worktree_state=evicted, task delta broadcast
- [x] #2 Grace scales with setup_duration_ms; a pinned task is never evicted; base grace 0 disables the tier
- [x] #3 Manual evict works on a single task and on every suspended task of a project
- [ ] #4 Opening an evicted or missing task restores the checkout, runs setup with visible output, then resumes the agent; the UI shows 'restoring workspace…' meanwhile
- [ ] #5 Restore failure (branch gone, WIP parent mismatch) lands on an actionable card, never a dead terminal
- [x] #6 Tests cover eviction guards and the restore path
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Split: this task is the server half. The stale-WIP decision surface — the second half of AC #5 — is TASK-63, which depends on this.

**1. `lib/worktree/evict.ts` — `evictWorktree(projectPath, worktreePath)`.** `worktree remove --force` then `prune`, under the per-repo lock, and no branch delete. `removeWorktree` cannot be reused: it deletes the branch, because it exists to undo a failed create, and eviction's whole premise is that the branch is what survives. `discardCheckout` in restore.ts is already exactly this operation and gets lifted here so both callers share one.

**2. Setup and `worktree_copy` on restore** — the gap TASK-38's review left open.
- `restoreWorktree` takes a `WorktreeProject` and re-copies the copy list, BEFORE applying the WIP. Order is load-bearing: if a copied file is also tracked, the snapshot is the user's work and the copy is a project template, so the snapshot has to win.
- `spawnAgent` takes an optional setup command and wraps with `wrapWithSetup`, which is how create already puts setup output in the agent tab rather than behind a silent wait. Passed only when a restore just ran — a resume that changed no directory has nothing to set up.
- `setup_duration_ms` re-records on restore, which is what makes the grace self-correcting.

**3. Restore runs at the top of `runResumeLadder`, not behind a new endpoint.** §5.6 is explicit that eviction is not a lifecycle state — it is `worktree_state` on a suspended task, and opening one restores before resuming. Inside the promise `resuming` holds, so the concurrency is already handled by `resumeTask`'s existing dances with in-flight suspends and resumes; the client keeps one POST; and every door that reopens a task restores without knowing it has to. Catch: the ladder captures `row` before the loop and `spawnAgent` reads `row.cwd`, which the restore has just moved — re-read the row.

**4. The evict tier lives in `Harvester`, not a new class.** Same timer, same `inFlight`, same shutdown wait — and shutdown has to cover both tiers. `sweep()` becomes `sweepIdle()` + `sweepEvict()`, over `liveTasks()` and a new `suspendedTasks()`. The trap: `tick()` currently returns early when `harvestAfterMs <= 0`, and that early return must not disable eviction — the tiers get independent switches, or turning off idle harvesting silently turns off eviction with it.

**5. Grace = base x min(1 + setup_duration_ms / 30_000, 4), from `last_active_at`.** Base default 7 days, 0 disables. So a task restoring in 200ms waits ~7 days, a 30s install 14 days, a 90s install 28 days — §5.6's own example. The cap stops one pathological install pinning a task forever. Measured from `last_active_at` and not `idle_since`: the latter is about the agent, and what grace asks is how long since the user cared. `pinned` exempts outright.

**6. Manual evict: `POST /api/tasks/:id/evict` and `POST /api/projects/:id/evict`** (every suspended task in it). HTTP rather than a socket message for the reason the resume route already gives: it runs git and can fail in ways the caller has to see.

**7. AC #5's first half: branch gone.** A failed reopen. The resume route catches `WorktreeError` and answers 409 with the kind rather than letting it become a 500; `AgentPane` already turns a non-ok resume into a failure card with a retry, so this is making the error survive the trip. The stale-WIP half is TASK-63.

**8. Tests.** `harvester.test.ts` for the guards — past grace, pinned, base 0, grace scaling with setup_duration_ms, a live task never evicted, and idle-harvesting-off not disabling eviction. `worktree.test.ts` for the round trip through `resumeTask`: an evicted task reopens with its dirt back and its setup re-run. Plus the branch-gone landing.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Server half done.** ACs 1, 2, 3 and 6 are met; 4 and 5 are met server-side with a frontend remainder — see below.

New: `lib/worktree/evict.ts` (`evictWorktree` + `discardCheckout`, lifted out of restore.ts) and `lib/worktree/copy.ts` (`parseCopyList`, `copyProjectFiles` and `WorktreeProject`, lifted out of create.ts so restore can share them).

**`restoreWorktree` now takes the project and re-copies `worktree_copy` — before applying the WIP, not after.** A copy entry may name a tracked path, and then the project's template and the user's snapshot both have an opinion about it. Copying first lets `read-tree --reset` overwrite it, so the user's work wins. Tested both ways.

**Restore runs at the top of `runResumeLadder`**, inside the promise `resuming` holds, so it inherits the serialization `resumeTask` already does. Two catches, both real: the ladder captures `row` before the loop and `spawnAgent` reads `row.cwd`, which the restore has just moved — so the row is re-read; and `spawnedAt` is re-stamped, which is what makes the grace self-correcting (the number it scales by is the last restore's, not one measured when the task was new).

**Setup is wrapped on the first rung only, and a rung that fails with setup wrapped stops the ladder.** Re-running a cold `bun install` per rung would turn one failed resume into four installs, and walking on after setup failed would spawn a bare agent into a half-built workspace and report it a success. Only when the *stamp* says setup failed: a setup still running is the common case, not a failure — `awaitAgentStart` caps at a few seconds and answers on whether the process is up, so a long install is a successful rung whose output the user watches in the tab. That is also how AC #4's 'visible output' is satisfied: the setup wrapper puts it in the agent tab, exactly as create does.

**Both tiers share one timer and are switched separately.** `tick()` used to return early on `harvestAfterMs <= 0`; left in place that would have let a user who turned off idle harvesting silently turn off eviction with it, and the two settings answer different questions (memory vs disk). There are tests for each direction.

**Grace = base x min(1 + setup_duration_ms / 30_000, 4), off `last_active_at`.** `idle_since` is the agent's clock; what grace asks is how long since the *user* cared, and a task someone was reading five minutes ago whose agent has been idle a week is not one to evict under them. The cap stops one pathological setup pinning a task forever. Neither this nor `setHarvestAfter` has a settings surface yet — both run on their defaults, which is the state `setHarvestAfter` was already in.

**`evictTask` refuses anything not suspended, and never evicts without a snapshot.** The suspended guard is what discharges every process guard §5.5 has: a live task has an agent mid-turn or a build in a shell tab in that directory. A manual evict on a live task is refused (409) rather than closing it on the caller's behalf. `snapshotTaskWip` answering null — nothing to capture, or a snapshot already waiting on the user's decision — is always a reason to keep the directory.

**What remains, and why it is frontend:** AC #4's 'restoring workspace…' banner and AC #5's stale-WIP card both need `worktreeState`/`wipPending` on `TaskInfo`, which is TASK-63's first AC — the client cannot currently tell a restore from an ordinary resume. AC #5's other half, a branch deleted while the task was evicted, is done: the resume route answers 409 with the `WorktreeError` kind instead of a 500, and `AgentPane` already renders a non-ok resume as a failure card with a retry.

Verified: 824 unit + 94 render, 0 fail; `tsc --noEmit` clean. Twelve new tests.

**Code review (`/code-review --fix`) found one high-severity race, fixed and now covered.**

`evictTask`'s only liveness guard was `lifecycle !== "suspended"`, and the resume ladder deliberately leaves the row `suspended` for its whole run — it only writes `live` on the rung that works, which is why `suspendTask` consults `this.resuming` rather than the row. So a harvester tick landing inside a reopen (a task past its grace that the user has just clicked — not a hypothetical) read suspended + present *after* `restoreTaskWorktree` had rebuilt the checkout, took a snapshot, and ran `git worktree remove --force` on the directory the agent had just been spawned into. Secondary damage: the snapshot stamped `wip_ref` on a row about to be `live`, which is the encoding for 'owes the user a decision' and would then have blocked that task from ever being evicted again.

Fixed with an `evicting` map beside `resuming`/`suspending`, and `evictTask` split into a synchronous registrar plus `doEvict`. The asymmetry is what makes it safe: **eviction refuses while a resume is in flight; a resume waits for an eviction.** Only one side waits, so the two can never wait on each other. Both register before their first await, and the registration sits in an unbroken synchronous block, so neither can slip past the other's guard. Nothing is lost by refusing — the tier is a sweep on a timer, and its next tick judges the task the resume produced, which is live and therefore not a candidate.

Also fixed: `POST /api/projects/:id/evict` 404s on an unknown project id, where it previously answered `200 {evicted: 0}` — indistinguishable from a real project whose tasks are all live.

**Three regression tests added, and verified to fail without the guards** (both collision tests fail in exactly the described way when the two lines are removed: the checkout ends `evicted` after a resume, and an eviction proceeds mid-resume). They need no hooks into the implementation — both entry points register before their first await, so whichever call starts second always sees the first.

Re-verified: 827 unit + 94 render, 0 fail; `tsc --noEmit` clean.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude
created: 2026-08-31 06:56
---
From TASK-38's code review: restore currently does NOT re-run `setup_command` or re-copy `worktree_copy`. `lib/worktree/restore.ts` rebuilds the checkout and reads the WIP back, and stops there — `wrapWithSetup` is only wired into `createTask`, so the setup half has to be added on the open/resume spawn path, which is where AC #4 already puts it.

The consequence to keep in mind while building that: `git add -A` honours `.gitignore`, so the snapshot cannot carry ignored files. A project with `worktree_copy = .env` and `setup_command = bun install` gets a checkout back with neither until this lands — `worktree_copy` needs re-copying as well as setup re-running, and AC #4 only names setup. `copyProjectFiles` is private to `create.ts` and will need exporting or lifting.
---
<!-- COMMENTS:END -->
