---
id: TASK-118
title: 'Backlog section in the Explorer: filter and sort the task cards'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-26 16:33'
updated_date: '2026-09-26 16:44'
labels:
  - frontend
dependencies: []
priority: medium
ordinal: 120000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Explorer's backlog section (src/frontend/components/BacklogSection.tsx) shows each status in Backlog.md board order, which follows task numbers, and has no way to narrow the list. On a mature project the Closed tab holds over a hundred tasks oldest first, so the ones just finished sit at the very bottom: on 2026-09-26 TASK-116 and TASK-117 were rows 117 and 118 of the Closed tab and read as missing. Add a filter and a sort. The filter matches the task id, title and labels (and ideally the description), case-insensitively, and applies to both tabs with the tab counts reflecting it. The sort offers board order, recently updated, recently created and task id; Closed defaults to recently updated so the newest finished work is on top, while Open keeps board order by default and keeps its status headers under every sort. Compose from components/v2 (FilterInput exists) and semantic tokens. The filter text and sort choice survive tab unmounts the way the Open/Closed tab choice already does (view-state-store, keyed by session). The grouping and sorting stay pure functions next to groupBacklog so they can be unit tested without a DOM.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Typing in the filter narrows the cards on the current tab to those whose id, title or labels match, case-insensitively, and the Open and Closed counts reflect the filter
- [x] #2 Clearing the filter restores the full list
- [x] #3 A sort control offers board order, recently updated, recently created and task id
- [x] #4 The Closed tab defaults to recently updated, so the most recently finished task is the first card
- [x] #5 The Open tab defaults to board order and keeps its status headers under any sort, sorting within each status
- [x] #6 Tasks without an updated date sort by created date, and ties fall back to board order so the list is stable
- [x] #7 The filter text and sort choice survive switching away from the Explorer and back, per session
- [x] #8 Unit tests cover filtering, each sort, the per-tab defaults and the date fallbacks against the pure functions
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Move grouping into a pure backlog-list.ts and add filter, sorts and per-tab defaults. 2. Store filter and per-tab sorts in the explorer view-state slot. 3. Add FilterInput and a v2 Select under the tabs. 4. Unit tests for the pure functions, render tests for wiring and remount survival. 5. Verify in a browser.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Pure list logic moved to components/backlog-list.ts (groupBacklog, sortBacklogTasks, matchesBacklogFilter, dateKey, per-tab defaults) with bun tests. Filter words are ANDed across id, title, labels and description. Sorts: board, recently updated (falls back to created), recently created, newest ID (numeric, subtasks after parent). Undated tasks go last; ties keep board order. State lives in the explorer view-state slot per root: backlogFilter plus backlogOpenSort/backlogClosedSort, null meaning the tab default; resolveBacklogSort validates stored values. Escape clears the filter. Verified in a browser on an isolated server: Closed opens with TASK-117 first, filter narrows and counts follow, state survives switching sections.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a filter (id, title, labels, description; words ANDed; Escape clears) and a per-tab sort (board, recently updated, recently created, newest ID) to the Explorer backlog section. Closed defaults to recently updated, Open to board order with status headers kept. Logic lives in backlog-list.ts; state persists per task in the view-state store. Verified by bun test and Vitest suites, tsc, a high-effort code review with no findings, and a browser check where Closed now leads with TASK-117.
<!-- SECTION:FINAL_SUMMARY:END -->
