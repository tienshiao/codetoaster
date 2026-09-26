---
id: TASK-118
title: 'Backlog section in the Explorer: filter and sort the task cards'
status: To Do
assignee: []
created_date: '2026-09-26 16:33'
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
- [ ] #1 Typing in the filter narrows the cards on the current tab to those whose id, title or labels match, case-insensitively, and the Open and Closed counts reflect the filter
- [ ] #2 Clearing the filter restores the full list
- [ ] #3 A sort control offers board order, recently updated, recently created and task id
- [ ] #4 The Closed tab defaults to recently updated, so the most recently finished task is the first card
- [ ] #5 The Open tab defaults to board order and keeps its status headers under any sort, sorting within each status
- [ ] #6 Tasks without an updated date sort by created date, and ties fall back to board order so the list is stable
- [ ] #7 The filter text and sort choice survive switching away from the Explorer and back, per session
- [ ] #8 Unit tests cover filtering, each sort, the per-tab defaults and the date fallbacks against the pure functions
<!-- AC:END -->
