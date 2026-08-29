---
id: TASK-25
title: 'Task list sidebar: recency, filter, state dots, suspended rows'
status: To Do
assignee: []
created_date: '2026-08-29 00:03'
labels:
  - frontend
milestone: m-3
dependencies:
  - TASK-20
documentation:
  - docs/v2-architecture.md
ordinal: 25000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rework AppSidebar.tsx into the chat-history / resume list (§7.5). Recency ordering across projects with project grouping as a toggle; a filter box; agent-state dots (busy / idle / needs_attention) and the last_message preview; suspended tasks as ordinary clickable rows (they are the normal resting state, not an error); archived tasks behind a toggle; close action (confirm when busy); the OSC terminal title shown as a subtitle via naming.ts's meaningfulTitle/stripDecoration projection. hooks/use-sidebar-drag.ts (manual reordering) is removed — you don't hand-sort cattle.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Default ordering is by last_active_at; a toggle groups by project
- [ ] #2 Filter box narrows the list by title, project, and last_message
- [ ] #3 Each row shows a state dot for busy/idle/needs_attention and the last_message preview
- [ ] #4 Suspended tasks look like normal rows; clicking one navigates to it and triggers resume
- [ ] #5 Archived tasks are hidden unless the show-archived toggle is on
- [ ] #6 use-sidebar-drag.ts is deleted
<!-- AC:END -->
