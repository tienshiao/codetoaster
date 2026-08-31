---
id: TASK-63
title: 'Stale-WIP decision surface: apply, keep, or discard a refused snapshot'
status: Done
assignee:
  - '@claude'
created_date: '2026-08-31 07:17'
updated_date: '2026-08-31 07:55'
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
- [x] #1 TaskInfo carries worktreeState and wipPending, and wipPending is true only for a present checkout with a WIP ref still set
- [x] #2 A task owing a decision shows a banner naming the three choices, and no banner appears for a task whose restore applied cleanly
- [x] #3 Apply writes the snapshot into the live checkout, then clears the ref and the columns; it confirms first, naming what it overwrites
- [x] #4 Keep dismisses without touching git, and the banner returns on the next load because the row still says so
- [x] #5 Discard drops the ref and clears the columns, and the banner does not come back
- [x] #6 Tests cover the three actions and the wipPending projection
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. `TaskInfo` gains `worktreeState` and `wipPending`; `wipPending = worktree_state === 'present' && wip_ref !== null`, resolved in `taskInfo()`.
2. `TaskManager.applyTaskWip` / `discardTaskWip`, sharing a `pendingWip` guard so both refuse the same states — an evicted task's ref is how it is stored, not a decision, and a checkout not on disk has nothing to apply into.
3. `POST /api/tasks/:id/wip` taking apply|discard. Two actions, not three: 'keep' is the absence of a request, which is why it needs no fourth column.
4. `components/v2/Notice.tsx` — a full-width bar, distinct from AgentPane's transient click-through overlay because this is a state that waits for an answer.
5. `WipNotice` above the tab area in `TaskShell`, not inside a pane: the checkout is what every tab reads, and a split renders two agent panes for one question.
6. AgentPane says 'Restoring workspace…' when `worktreeState` is evicted or missing, which closes TASK-39 AC #4.
7. Server tests for the projection and the three answers; a render test for which of them reaches the server.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**`wipPending` is the pair of columns and nothing else.** `worktree_state = present` with `wip_ref` set. Testing `wip_ref` alone would be true of an *evicted* task, whose ref is simply how it is stored rather than a decision anyone owes — that distinction is the one thing the projection has to get right, and it has a test.

**'Later' sends nothing, and that is the design rather than a shortcut.** Dismissal is local component state. The work is still sitting in a ref, so a dismissal the server remembered would be a promise to forget about it that nothing has made — and persisting it would need a fourth state ('asked and deferred') when the entire point of this encoding is that there is no state beyond the two columns. The render test asserts no request is made, and it fails when the dismissal is removed (verified, not assumed).

**Only Apply confirms.** It writes over a checkout the user may have been working in since the restore. Discard destroys a snapshot they have just been told is unusable there, and the branch keeps every commit — making both confirm trains the reflex that gets a real confirmation clicked through. The dialog names what it overwrites instead of asking 'are you sure?'.

**The Notice's warning tone carries no tinted background, deliberately.** `bg-state-attention/10` is the obvious way to write it and is exactly what `index.css` warns against: Tailwind emits an opacity modifier over a `var()` as a `color-mix` inside a nested `@supports`, Bun's CSS bundler drops the nested block, and the bar renders solid amber. The palette exposes `-ch` channel triplets for washes and amber is not one of them, so the tone is a solid rule plus a dot instead of a sixth triplet.

Also: the jest-dom matchers are extended onto `expect` at runtime but not typed, so `toBeInTheDocument` passes the render suite and fails `tsc`. Followed the house idiom (`toBeNull`, `toBeTruthy`, `.textContent`) rather than widening the type setup.

TASK-39 AC #4's 'restoring workspace…' banner landed here too, since it needed `worktreeState` on the wire.

Verified: 831 unit + 99 render, 0 fail; `tsc --noEmit` clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A task whose restored snapshot was refused now says so and offers the three answers. `TaskInfo` carries `worktreeState` and `wipPending`; `POST /api/tasks/:id/wip` takes apply or discard; a `Notice` bar sits above the tab area — not inside a pane, because the checkout is what every tab reads and a split would otherwise ask the same question twice. Apply confirms first and names what it overwrites; Later is local and sends nothing, so the row goes on saying the decision is outstanding; Discard drops the ref. Also closes TASK-39 AC #4: the reopen overlay says 'Restoring workspace…' rather than 'resuming…' when there is a checkout to rebuild, which needed `worktreeState` on the wire. Verified with four server tests over a real repository and five render tests, one of which was checked to fail when the dismissal is removed; 831 unit + 99 render, 0 fail, `tsc --noEmit` clean.
<!-- SECTION:FINAL_SUMMARY:END -->
