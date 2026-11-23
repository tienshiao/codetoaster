---
id: TASK-146
title: Task list reorders are visible and briefly lock out clicks
status: To Do
assignee: []
created_date: '2026-11-23T01:34:00Z'
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
