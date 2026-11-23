---
id: TASK-146
title: Task list reorders are visible and briefly lock out clicks
status: In Progress
assignee:
  - '@claude'
created_date: '2026-11-23T01:34:00Z'
updated_date: '2026-11-23T02:19:00Z'
labels:
  - frontend
dependencies: []
ordinal: 149000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The sidebar task list re-sorts in place when a task reranks (rank_at moves after 60s of quiet, TASK-116), a task is created, or one is suspended or archived. Nothing marks the move, so a row can slide under the pointer just as the user clicks, and the click or row action (open, archive, suspend) lands on a different task than the one they aimed at. Archiving the wrong task this way is the worst case. Two things are needed: a visual cue showing which rows moved, like the fade that TASK-136 added for changed Explorer rows (change-pulse-store.ts, the --changed token), and a short window after any reorder during which clicks and row actions in the list are ignored, so an aimed click cannot hit a row that just arrived under the pointer.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 When the list order changes, the rows that moved get a visual cue (an animated move, a highlight that fades, or both) so the reorder is noticeable at a glance
- [ ] #2 For a short window after a reorder (well under a second, with the value in one named constant), clicks on rows and row actions such as archive and suspend do nothing, and the list shows that it is briefly locked
- [ ] #3 A refresh or snapshot that leaves the order unchanged causes no cue and no lockout, and neither happens on first load, remount or tab switch
- [ ] #4 A row whose age column or state dot updates without changing position causes no lockout
- [ ] #5 Several reorders in quick succession extend the lockout from the latest one instead of stacking cues
- [ ] #6 The cue colour comes from a v2 semantic token, and under prefers-reduced-motion the movement animation is skipped while the lockout still applies
- [ ] #7 Rendering tests cover a reorder cueing and locking, a click inside the window being ignored and one after it going through, and an unchanged refresh doing neither
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Reorder definition: compare the sequence the list actually draws (flat: row ids; grouped: each group header then its rows when open) between renders. Any change counts (a rank move, a row inserted, a row removed, a group moving or appearing) because each changes which row sits under the pointer; an age/state-dot/preview/selection update does not touch the sequence. Not a reorder: the first non-empty sequence (prev empty = first load, nothing was under the pointer), a remount (fresh baseline), and any render whose view inputs changed (filter, grouping, archived toggle, closed groups, the fetched archived list) since those are the user's own doing or the answer to it, so they rebaseline silently. 1. src/frontend/reorder-guard.ts: pure orderChange(prev, next) returning changed + cued ids (inserted rows, plus rows outside the longest run that kept relative order, so one row jumping to the top cues just that row; removal locks but cues nothing). useReorderGuard(sequence, view, {now}) holds baseline, lockedUntil = now + REORDER_LOCK_MS (500ms, extended by the latest reorder, one timer) and per-row cue {at, seq} with per-row parity so a repeat restarts rather than stacks; computed during render (setState-in-render) so the committed frame is already locked; cue expires by clock read per render. 2. TaskSidebar useTaskSidebar: build the drawn sequence and view deps, apply the cue class (reusing change-flash-a/b and --changed from TASK-136) to rows and grouped rows, return taskListLocked. 3. AppShell: taskListLocked prop; the list container ignores clicks while locked via onClickCapture (only DOM descendants, so portaled dialogs are unaffected; keyboard Enter/Space clicks are blocked too), aria-busy, a dim and not-allowed cursor; opacity transition motion-safe only. Reduced motion: the flash CSS already steps instead of fading, lockout unchanged. 4. Tests: reorder-guard.test.ts for orderChange; TaskSidebar-reorder.render.tsx with sidebar+AppShell, injected clock/fake timers: rank move cues and locks, click inside window ignored and after it goes through, unchanged refresh and age/state update neither, insertion and removal lock, first load and remount quiet, filter change quiet, rapid reorders extend. 5. Wiki: new modules/task-list-order.md page, index, log.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented. Reorder = any change in the sequence the list draws (flat: row ids; grouped: each project header then its rows when open), so rank moves, insertions and removals all lock; in-place updates (age, state dot, preview, selection) do not touch the sequence. Quiet: the first non-empty sequence (load), a remount, and a sequence change in a render where a view input changed (filter, grouping, archived toggle, closed groups, fetched archived list) while the live tasks array kept its identity; if both changed it counts. reorder-guard.ts holds orderChange (cue = inserted rows plus rows outside a longest increasing subsequence of surviving positions; a removal locks but cues nothing, the dimmed list is its only cue) and useReorderGuard (compared during render so the committed frame is already locked; REORDER_LOCK_MS = 500 from the latest reorder; one timer for unlock and cue expiry so a cue never replays on a later remount; per-row parity restarts a repeat). Cue reuses the change-flash-a/b keyframes and the --changed token (comment updated); reduced motion already steps the flash, lockout unchanged. AppShell takes taskListLocked: onClickCapture on the list container drops clicks (rows, row actions, group headers, keyboard Enter/Space too) but only when the DOM target is inside the container, because React routes portaled dialog clicks through the owning row; aria-busy, opacity-70, not-allowed cursor, opacity transition motion-safe only. Tests: reorder-guard.test.ts (7) and TaskSidebar-reorder.render.tsx (17, fake timers for Date and setTimeout), including insertion, removal, first load, remount, filter, grouped chevron, rapid extension, restart parity, cue expiry and the archive confirm working while locked (mutation-checked: fails without the contains guard). Wiki: new modules/task-list-order.md, index, log, change-watcher link. Not browser-verified here (main session does it); isolated server on 4601 booted and served the new CSS rules.

Code review (medium, with fix): 2 findings. Fixed: a repeat cue took its parity from the pruned map, so a row whose cue had expired but whose timer had not fired yet (throttled background tab) kept the same class and did not restart; now read from the drawn map. Skipped: injecting a clock through useTaskSidebar (the guard takes now as an option; the render tests fake setTimeout anyway). bun run test: bun test 2204 pass, 1 fail (manager.test.ts load timeout under three parallel agents; 99/99 pass alone), vitest 617 pass; typecheck clean.

Code review (high, v2...HEAD): 6 findings; fixed 4 in a fix commit (grouped header-only cue now lights the whole group, archived rows are data once showing so a delete for good locks, appending/removing at the end no longer locks, cues pruned by the clock per render, plus useTaskSidebar now takes an injected now for the guard), skipped 1 (browser verification and final summary are the main session's, and it has done the check); bun test 2205 pass / 1 known manager.test.ts exit-broadcast flake, vitest 621 pass, typecheck clean.
<!-- SECTION:NOTES:END -->
