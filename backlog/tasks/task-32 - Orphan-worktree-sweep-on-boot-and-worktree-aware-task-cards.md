---
id: TASK-32
title: Two-way boot reconciliation and worktree-aware task cards
status: Done
assignee:
  - '@claude'
created_date: '2026-08-29 00:03'
updated_date: '2026-08-31 22:42'
labels:
  - server
  - frontend
  - git
milestone: m-4
dependencies:
  - TASK-39
  - TASK-25
documentation:
  - docs/v2-architecture.md
ordinal: 32000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Risk 5 (§9) / §5.6. On boot, per project, compare `git worktree list --porcelain` against task rows in both directions: (a) directory on disk with no row → remove if clean; if dirty, leave it and surface an 'unclaimed worktree' card with a manual delete — never auto-delete dirty, even orphans; (b) row says present but the directory is gone → worktree_state=missing, restored on open; branch also gone → broken-but-actionable card. Then git worktree prune and expire WIP refs past retention. Cards show worktree_state, branch, dirty file count, unpushed commit count, and merged-into-base (git status --porcelain, rev-list @{u}.., branch --merged), computed lazily on render or cached per harvester tick; merged tasks get an 'archive?' nudge.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Boot removes clean worktrees with no matching non-archived row and logs what it removed
- [x] #2 Dirty orphan worktrees are never deleted automatically; they appear as unclaimed cards with a manual delete
- [x] #3 A row whose directory is missing is flipped to worktree_state=missing and restores on open; a missing branch yields an actionable card
- [x] #4 The sweep never touches directories outside ~/.codetoaster/worktrees
- [x] #5 Task cards show worktree state, branch, dirty count, unpushed count, and merged status without blocking render
- [x] #6 Tests cover both reconciliation directions against a temporary directory and repository
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Three slices, committed separately.

**Slice 1 — the sweep (server/git; AC 1, 2, 3, 4, 6).**
New `src/lib/worktree/reconcile.ts`, run from `TaskManager.reconcileWorktrees()` and fired (not awaited) on the boot path in server.ts beside `expireArchivedWip`.
- Direction (a): walk `worktreesRoot()/<projectId>/<taskId>`. A directory with no non-archived row naming it is an orphan. Its repository is found from the directory itself (`rev-parse --git-common-dir`), not from the project, so an orphan outlives the project that made it. Clean → `discardCheckout` + log. Dirty, or a directory git cannot account for at all → left alone and reported as unclaimed. `dirty === null` (git failed, not a worktree) fails closed to unclaimed, matching status.ts's house rule that an unestablished fact is never 'safe'.
- Direction (b): a non-archived row saying `present` whose directory is gone → `worktree_state = missing`. `restoreTaskWorktree` already rebuilds `missing` on open, and already throws a typed WorktreeError when the branch is gone too, which the route turns into an actionable card.
- Then `git worktree prune` per distinct repository, all of it under `withRepoLock`.
- AC#4 is a guard and not merely an enumeration invariant: every path is re-checked against `worktreesRoot()` immediately before removal, the way `removeTaskDir` re-checks the tasks root.

**Slice 2 — card status (server).**
`branchStatus` already computes exactly dirty/unpushed/merged. Cache it on TaskManager per task and carry it on `TaskInfo` as a nullable field, so a row renders immediately with whatever it has and fills in — AC#5's 'without blocking render'.
Refreshed on the events that can actually change it rather than on a fixed timer: the Stop hook (the agent finished a turn, which is when the tree moved), restore, resume and boot; the harvester tick is only a backstop for entries stale past a few minutes. Only `present` checkouts are ever computed. A 30s blanket sweep over thirty tasks would be ~150 git processes a minute for facts that mostly did not change.

**Slice 3 — the sidebar (frontend).**
- Task rows gain branch, dirty count, unpushed count and merged status from the new TaskInfo field; a merged task gets the 'archive?' nudge.
- A new labelled section at the foot of the task list for unclaimed checkouts, each with a manual delete. One new AppShell prop — the shell stays layout-only. Composed from components/v2 and semantic tokens.
- `POST` route for the manual delete re-verifies the path against `worktreesRoot()` server-side; a path from a client is never trusted.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**The sweep.** `src/lib/worktree/reconcile.ts` holds direction (a) — the half that needs git and the filesystem — and `TaskManager.reconcileWorktreesOnBoot` holds direction (b), which is a row update with no git in it. It is fired, not awaited, on the boot path beside `expireArchivedWip`.

An orphan's repository is asked of the orphan itself (`rev-parse --git-common-dir`, confirmed with a `--show-toplevel` so a bare repo cannot resolve to its parent), not of the project: a checkout no row claims may well outlive the project that made it (TASK-64). git's own `worktree list --porcelain` supplies the same mapping for free where it parses, and the directory walk catches what it misses — including a checkout whose registration was pruned while the directory stayed.

**Three guards, each earned.**
- `isWithinWorktreesRoot` moved into `paths.ts` beside the function that composes the root, and is re-asked immediately above the recursive delete rather than trusted from the enumeration — the same shape as `removeTaskDir`.
- `removed` is pushed only after checking the directory is actually gone. `discardCheckout` swallows its own failures, and the boot log's whole purpose is accountability for a deletion.
- The sweep declines outright on a database with no task rows. Every real checkout is unclaimed by an empty one, and 'no rows' is far likelier to be a daemon on the wrong `--db` than a root full of orphans. Writing the tests surfaced this: a suite with an in-memory database would have deleted the developer's own worktrees, and `test/git-repo.ts` gained `foreignCheckouts` to hold them out.

**Card status.** `branchStatus` already computed exactly what AC #5 wants, so the work was caching it, not computing it. Kept in memory rather than in a column: every one of these facts is about the working tree and the ref store, and a commit made in a shell tab never comes past us — a persisted copy would be a claim about the disk that nothing re-checks and that survives a restart looking authoritative.

Measured on the events that move it — a finished turn (the Stop hook, which is when the agent stopped editing), a restore, a create — with the harvester tick only a backstop past a five-minute TTL, and a purge there for rows that no longer have a checkout. A blanket 30s sweep over thirty tasks would be ~150 git processes a minute for facts that mostly did not change.

**A bug this introduced and the fix.** Measuring in the background collided with the WIP snapshot: plain `git status` takes `index.lock` to write back the index it refreshed, and `snapshotWip`'s `git add -A` needs it — two archive tests failed with `Unable to create '…/index.lock': File exists`. `dirtyCount` now passes `--no-optional-locks`, which is exactly what git provides for a tool that polls status, and costs only the cached-stat write.

Validation: `bunx tsc --noEmit` clean; `bun run test` green (906 unit across 15 files, 111 render across 15). `~/.codetoaster/worktrees` verified untouched after full runs.

**Post-review fix (the important one).** `merge-base --is-ancestor` is reflexive, and `createWorktree` cuts the branch at exactly `base_ref` — so every brand-new worktree task reported `merged: true` and wore the 'archive?' nudge before its agent had written a line. The nudge was noise on 100% of new tasks.

`BranchStatus` gained `atBase` (branch tip is the commit the base ref names) rather than folding the condition into `merged`, and the card reads `merged && !atBase`. `branchIsExpendable` — what archive and hard delete use to decide whether a branch can go — deliberately still reads the raw `merged`: a branch with no commits of its own is precisely the one that is safest to delete. `baseCommit` now returns the peeled sha instead of a boolean, so `atBase` is a string compare rather than a sixth git startup.

Known tradeoff: after a *fast-forward* merge the base has moved to the branch tip, which is indistinguishable by refs alone from a branch that never started, so that case loses the nudge. Telling them apart would mean recording the base sha at create time. Strictly better than the false positive it replaces, and worth revisiting if the nudge proves load-bearing.

Also fixed in review: `create.ts`'s `discard()` was a verbatim copy of `discardCheckout` plus a branch delete (now composes it); `reconcile.ts` parsed a `branch` out of `worktree list --porcelain` that nothing read; `doArchive` never dropped its `spawnedAt` entry, leaking one per archived task for the life of the daemon.

Left alone deliberately: `doArchive` writes `worktree_state: "evicted"` unconditionally where `doEvict` re-checks the directory first. Nothing reopens an archived task, and the state is self-correcting through the very sweep this task added — an archived row is not in `claimed`, so a directory its removal failed to take is found as an orphan and either removed or carded.

Re-verified: `bunx tsc --noEmit` clean, `bun run test` green (908 unit, 111 render).

**Runtime verification (/verify) and the gap it found.**

Driven against a live daemon on `--port 4599 --db /tmp/verify.db`. Confirmed: the card arrives `null` at create and fills in ~3s later (AC #5's 'without blocking render', end to end) with `merged: false` on a fresh task; a clean orphan removed and logged **with its branch left standing**; a dirty orphan untouched, its uncommitted file intact, carded on the wire and in the sidebar; a vanished directory flipped to `missing` with its card facts purged, then rebuilt to `present` on reopen; registrations pruned; the delete route refusing both a path it is not offering and a `..` escape (404 each) while deleting the real card (200); and the confirm dialog showing the *full* path and saying the work cannot be recovered.

**The gap: a second daemon on a different `--db` swept the first's checkouts.** The worktrees root belongs to the machine — it is under the user's home and knows nothing about databases — while the rows that claim a directory live in whichever database the daemon was started with. So daemon B saw every checkout daemon A had made, could not see the rows claiming them, and removed the clean ones. The empty-database guard did not cover it: B had a task of its own, so it swept.

Reproduced in the act — an orphan survived a fresh database and was removed the moment the daemon restarted on one that had a task.

**Fix.** `checkoutsOnDisk` is now scoped to project ids the caller can name, and `reconcileWorktrees` takes them. The manager supplies its projects' ids plus the id embedded in each task's own worktree path — `<root>/<projectId>/<taskId>`, so the parent directory's name — because a task can outlive the project that made it (TASK-64) and would otherwise have its live checkout read as a stranger's.

Project ids are minted per database, so the id is the distinction. The cost, documented at `checkoutsOnDisk`: a doubly-orphaned checkout — project *and* task row both gone — can no longer be named and stays on disk. That takes two failures to reach, since deleting a task already removes its checkout, and it is the right way round to be wrong.

Re-verified at runtime with two databases on one machine: daemon B left both of A's checkouts alone while still removing its own orphan. `bun run test` green (909 unit, 111 render).
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude
created: 2026-08-31 06:56
---
From TASK-38's code review: `TaskManager.restoreTaskWorktree` returns early when the task was deleted while git was working, which leaves a checkout on disk for a row that no longer exists — `deleteTask` removes no worktrees. Cleaning up in place was rejected there because the obvious call (`removeWorktree`) also deletes the branch, which is more destructive than the delete path itself. It is the 'directory on disk, no row' case this task already owns: remove if clean, surface an unclaimed-worktree card if dirty.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Two-way boot reconciliation and worktree-aware task cards (§5.6, Risk 5).

On boot, per repository, the checkouts on disk are compared against the task rows in both directions: a clean checkout no non-archived row claims is removed and logged, a dirty one is left exactly as it was and surfaced as an unclaimed card with a manual delete, and a row claiming a directory that has gone is flipped to `missing` so the next open rebuilds it. Then `git worktree prune` per repository, all of it under the repository lock.

The module is written to one rule: a checkout is deleted only when we have *established* that it holds nothing. `dirtyCount`'s `null` — git could not be asked, or the directory was never a worktree — ends as an unclaimed card and never as a deletion, the same fail-closed discipline `status.ts` already uses for archive.

Task cards now carry branch, uncommitted count, unpushed count and merged status, cached server-side and pushed, so a row draws immediately and fills in; a merged task gets the 'archive?' nudge. Nothing renders as a zero it did not measure — `null` on the wire means not measured, and the row shows nothing rather than asserting a clean tree nobody checked.

Verified with `bunx tsc --noEmit` (clean) and `bun run test` (906 unit, 111 render, all passing), and by confirming `~/.codetoaster/worktrees` is untouched after full runs. New tests: 9 in `src/lib/worktree/reconcile.test.ts` against real repositories, 5 in `src/lib/tasks/worktree.test.ts` for the manager wiring and the empty-database guard, and 11 rendering tests for the row and the unclaimed band.
<!-- SECTION:FINAL_SUMMARY:END -->
