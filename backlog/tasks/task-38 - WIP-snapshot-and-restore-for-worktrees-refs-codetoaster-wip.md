---
id: TASK-38
title: WIP snapshot and restore for worktrees (refs/codetoaster/wip)
status: Done
assignee:
  - '@claude'
created_date: '2026-08-29 00:17'
updated_date: '2026-08-31 06:56'
labels:
  - server
  - git
milestone: m-4
dependencies:
  - TASK-29
documentation:
  - docs/v2-architecture.md
priority: high
ordinal: 38000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
§5.6: make dirty worktrees evictable without touching the branch. snapshot(task): build a commit of the full working state through a throwaway index (GIT_INDEX_FILE=$tmp read-tree HEAD; add -A; write-tree; commit-tree -p HEAD) and point refs/codetoaster/wip/<task-id> at it; store wip_ref/wip_at. restore(task): `git worktree add <path> <branch>`, `git read-tree -u --reset <wip>`, `git reset --mixed HEAD` so dirt reads back as dirt, then setup_command. Guard: if the WIP commit's parent != current branch HEAD (the branch moved while evicted), restore the clean tree and set a needs-decision flag — apply stale WIP / keep as ref / discard — never silently overwrite newer work. Verified on a scratch repo: modified stays modified, untracked stays untracked, branch history untouched. Known: staged/unstaged flatten; ignored files are not captured (setup hooks cover them).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 snapshot creates refs/codetoaster/wip/<task-id> without modifying the live worktree's index, working tree, or branch
- [x] #2 restore on a fresh worktree brings back modified tracked files as modified, deleted tracked files as deleted, and untracked files as untracked, with index == HEAD
- [x] #3 restore refuses to apply a WIP whose parent is not the branch HEAD and exposes apply/keep/discard actions
- [x] #4 A task with no WIP ref restores to a clean checkout
- [x] #5 Re-snapshotting overwrites the ref; dropping it makes the objects gc-able
- [x] #6 Tests cover each case against a temporary repository
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. gitSpawn gains an `env` option (src/api/utils.ts): `GitSpawnOptions.env?: Record<string,string>`, merged over process.env. Needed twice — GIT_INDEX_FILE for the throwaway index, and GIT_AUTHOR_*/GIT_COMMITTER_* for commit-tree. (Verified: under `user.useConfigOnly=true` commit-tree fails with 'Author identity unknown'; the env vars fix it. A WIP commit is ours and should not be attributed to the user anyway.)

2. Extract src/lib/worktree/repo.ts: move `repoRootOf` and `lockKeyFor` out of create.ts. Restore does `worktree add`, so it must take the same per-repo lock. Pure move.

3. src/lib/worktree/wip.ts — DB-free primitives:
   - wipRefFor(taskId) -> refs/codetoaster/wip/<id>
   - snapshotWip({worktreePath, taskId}) -> { ref, commit, at }
   - readWip(repoRoot, taskId) -> { commit, parent, tree } | null
   - applyWip(worktreePath, ref) — read-tree -u --reset then reset --mixed HEAD
   - dropWip(repoRoot, taskId)
   Snapshot runs the §5.6 recipe with cwd = the worktree; temp index at taskDir(taskId)/wip.index (absolute — a relative GIT_INDEX_FILE resolves against cwd), removed in a finally. Parent read as `<ref>^1^{commit}` not `^`, so a parentless commit fails cleanly. The ref is written unconditionally, clean tree or not: it keeps wip_ref/wip_at unconditional and makes the parent check the only branch in restore.

4. src/lib/worktree/restore.ts — the stale guard. `worktree add <path> <branch>` (no -b; the branch exists), then compare the WIP commit's parent to the NEW worktree's HEAD read AFTER the add, not to the branch tip read before it — the branch can move in between, and post-add is the value read-tree --reset would actually overwrite. Match -> applyWip. Mismatch -> leave the clean checkout, keep the ref, return wip: 'stale' so the card can offer apply/keep/discard. No ref -> wip: 'none', clean checkout. New WorktreeErrorKinds: branch-missing (branch deleted while evicted — TASK-39's card must tell this apart from a generic add failure), snapshot-failed, wip-apply-failed.

5. TaskManager wiring: snapshotTaskWip(id) and restoreTaskWorktree(id) call the lib and persist wip_ref/wip_at/worktree_state. Keeps lib/worktree DB-free and leaves TASK-39 as pure policy (grace maths, harvester tier, broadcast, UI).

6. Tests: extract tempRepo/git out of create.test.ts into test/git-repo.ts (test/ is where shared harness lives), then src/lib/worktree/wip.test.ts with one test per AC — including the gc one (update-ref -d, reflog expire, gc --prune=now, cat-file -e fails; verified refs/codetoaster/* gets no reflog, so nothing else keeps the objects alive) and a stale-guard test that commits to the branch from the main checkout between evict and restore and asserts the newer commit survived.

Verified on a scratch repo before planning: modified stays modified, deleted stays deleted, untracked stays untracked, staged flattens to untracked (documented), ignored files do not survive (documented); live status and branch tip byte-identical across the snapshot.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented as planned, with three things worth recording.

**`wip_ref` surviving a restore is how 'needs a decision' is spelled.** The schema has no column for it, and adding one would be a migration for a boolean. Instead `restoreTaskWorktree` clears `wip_ref`/`wip_at` when the snapshot applied and keeps them when it was refused — so `worktree_state = present` with a `wip_ref` still set *is* the task whose card owes the user apply/keep/discard, durably and across a daemon restart. TASK-39's card should read it that way rather than invent a flag.

**The snapshot commits as codetoaster, not as the user.** `commit-tree` refuses to build a commit with no identity, and `user.useConfigOnly = true` is a real setting — so without `GIT_AUTHOR_*`/`GIT_COMMITTER_*` in the environment the snapshot would silently stop protecting some users' work. Verified the failure and the fix on a scratch repo. This is what `gitSpawn` gained an `env` option for; `GIT_INDEX_FILE` is the other caller, and git only reads it from the environment, so there was no flag route.

**The staleness check is against the restored worktree's HEAD, read after `worktree add`, not the branch tip read before it.** They differ only in a race, and when they do the value that matters is the one `read-tree --reset` would actually overwrite.

Smaller notes: `readWip` uses one `rev-list -n 1 --parents` rather than two `rev-parse --verify`s, because `--verify` exits 1 when handed two arguments — and `--parents` makes a parentless snapshot an answer with one field rather than an error to interpret. A snapshot with no parent is treated as no snapshot, since the parent check is the only thing standing between a stale ref and someone's newer commit.

Test scaffolding: `test/git-repo.ts` now holds the scratch-repository fixtures `create.test.ts` had inline, and cleans up `~/.codetoaster/worktrees` and `~/.codetoaster/tasks` for everything it hands out. `src/lib/tasks/worktree-create.test.ts` renamed to `worktree.test.ts`, since it now covers restore as well as create.

Full suite green: 804 unit + 94 render, 0 fail. `tsc --noEmit` clean.

**Code review (`/code-review --fix`) found four real bugs in the first cut, all fixed and re-verified.**

1. `snapshotTaskWip` would overwrite a snapshot the user still owed a decision on. A task has one WIP ref and `snapshotWip` moves it unconditionally, so a stale-restored task that got dirty again and was evicted would have had the refused commit made unreachable — the user's apply/keep/discard taken away by an eviction they never asked for. It now answers `null` while `wip_ref` is outstanding, which the evict tier already reads as 'do not evict'.

2. `worktree add --force` on the restore path overrode more than the stale registration it was there for: it also overrides git's refusal to check out a branch already checked out elsewhere. If the user had the task's branch checked out in their own clone, restore would have given one branch two working trees, and the agent's next commit would move HEAD under the user's checkout. Now `git worktree prune` before a plain `add`. Verified on a scratch repo that prune clears the missing-but-registered case immediately and that the branch guard still fires. (`create.ts` keeps `--force` safely: `-b` means its branch is new.)

3. A restore that failed after `worktree add` left the checkout on disk while the row still said `evicted`, so every retry stopped at `assertPathFree` — and the path is fixed by the task's id and cannot be moved. Now rolled back like a failed create.

4. An applied restore cleared `wip_ref` on the row but never dropped the git ref, and `restoreWorktree` reads git rather than the row — so the next restore would reapply work the row said was consumed, undoing e.g. a `git restore .` the user ran deliberately.

Also fixed: `snapshotTaskWip` now distrusts `worktree_state = present` the way `restoreTaskWorktree` does; a vacuous test assertion (it checked for the scratch index at `<repo>/.git/wip.index`, which is not where it is written, so it would have held however badly the index leaked); and a `string | null` that `tsc` rejected.

Two findings deliberately not fixed here, both recorded as comments on the tasks that own them: restore does not yet re-run `setup_command` or re-copy `worktree_copy` (TASK-39 AC #4 — the setup wrapper is only wired into `createTask`), and a task deleted mid-restore leaves an orphan checkout (TASK-32's 'directory on disk, no row').

Re-verified after the fixes: 806 unit + 94 render, 0 fail; `tsc --noEmit` clean. Three regression tests added.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Dirty worktrees are now evictable. `lib/worktree/wip.ts` commits a checkout's whole working state — modified, deleted and untracked files alike — to `refs/codetoaster/wip/<task-id>` through a throwaway index, so the live tree, its index and the branch are untouched; `lib/worktree/restore.ts` rebuilds the checkout at the task's id-derived path and reads the snapshot back as dirt rather than as a commit. The guard is the point: a snapshot whose parent is no longer the restored worktree's HEAD is never applied, because the user may have committed to that branch from their own checkout while the task was evicted and `read-tree --reset` would have overwritten it silently. It is kept instead, and `TaskManager.restoreTaskWorktree` leaves `wip_ref` set — which, with `worktree_state = present`, is the durable encoding of 'this card owes the user apply/keep/discard' with no new column.

Also: `gitSpawn` gained an `env` option (`GIT_INDEX_FILE` and the commit identity can only be passed that way), `repoRootOf`/`lockKeyFor`/`assertPathFree` moved to `lib/worktree/repo.ts` so restore takes the same per-repository lock a create does, and three error kinds — `branch-missing`, `snapshot-failed`, `wip-apply-failed` — let TASK-39's restore-failure card tell a deleted branch from a git failure.

Verified with 12 new tests in `wip.test.ts` against temporary repositories (round trip per file kind, the stale guard applying nothing while the newer commit survives, the deliberate apply of a stale ref, a deleted branch, a directory removed by hand, re-snapshotting, and objects genuinely collectable after a drop) and 5 in `worktree.test.ts` for the row-level wiring. Full suite: 804 unit + 94 render, 0 fail; `tsc --noEmit` clean.
<!-- SECTION:FINAL_SUMMARY:END -->
