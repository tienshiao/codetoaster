---
id: TASK-38
title: WIP snapshot and restore for worktrees (refs/codetoaster/wip)
status: To Do
assignee: []
created_date: '2026-08-29 00:17'
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
- [ ] #1 snapshot creates refs/codetoaster/wip/<task-id> without modifying the live worktree's index, working tree, or branch
- [ ] #2 restore on a fresh worktree brings back modified tracked files as modified, deleted tracked files as deleted, and untracked files as untracked, with index == HEAD
- [ ] #3 restore refuses to apply a WIP whose parent is not the branch HEAD and exposes apply/keep/discard actions
- [ ] #4 A task with no WIP ref restores to a clean checkout
- [ ] #5 Re-snapshotting overwrites the ref; dropping it makes the objects gc-able
- [ ] #6 Tests cover each case against a temporary repository
<!-- AC:END -->
