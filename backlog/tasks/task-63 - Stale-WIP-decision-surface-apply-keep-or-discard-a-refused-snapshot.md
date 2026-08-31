---
id: TASK-63
title: 'Stale-WIP decision surface: apply, keep, or discard a refused snapshot'
status: To Do
assignee: []
created_date: '2026-08-31 07:17'
labels:
  - frontend
  - server
  - git
milestone: m-4
dependencies:
  - TASK-39
ordinal: 63000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The frontend half of TASK-39's AC #5, split out so the evict tier can land server-first.

When a task's checkout is restored and the branch has moved since the snapshot was taken, `restoreWorktree` refuses to apply the WIP: the checkout comes back clean at the branch, the agent resumes normally, and the ref is kept. That is deliberate — applying it would write the old version of every tracked file over the newer commit, silently. But it leaves the task owing the user a decision, and nothing currently shows it.

The state is already durably encoded and needs no migration: `worktree_state = present` with `wip_ref` still set IS the outstanding decision (an applied snapshot clears both the columns and the git ref; a refused one keeps both). It survives a daemon restart, which a flag in memory would not.

Scope: put `worktreeState` and `wipPending` on `TaskInfo`, add `POST /api/tasks/:id/wip` taking an action, and render a banner on the task offering the three choices. Deliberately NOT the richer worktree-aware card — dirty file count, unpushed commits, merged-into-base are TASK-32's, and building them here would build that surface twice.

The three actions: **apply** runs `applyWip` against the live checkout and then clears the ref and the columns; **keep** does nothing but dismiss, leaving the ref for later; **discard** runs `dropWip` and clears the columns. Apply is the one with teeth — it overwrites the working tree of a checkout the user may have already started working in, so it needs a confirmation that says what it will overwrite.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 TaskInfo carries worktreeState and wipPending, and wipPending is true only for a present checkout with a WIP ref still set
- [ ] #2 A task owing a decision shows a banner naming the three choices, and no banner appears for a task whose restore applied cleanly
- [ ] #3 Apply writes the snapshot into the live checkout, then clears the ref and the columns; it confirms first, naming what it overwrites
- [ ] #4 Keep dismisses without touching git, and the banner returns on the next load because the row still says so
- [ ] #5 Discard drops the ref and clears the columns, and the banner does not come back
- [ ] #6 Tests cover the three actions and the wipPending projection
<!-- AC:END -->
