---
id: TASK-85
title: >-
  Backlog section in the Explorer: Open and Closed, cards that open the task
  file
status: To Do
assignee: []
created_date: '2026-09-04 21:37'
labels:
  - frontend
  - ui
  - backlog
dependencies:
  - TASK-84
references:
  - src/frontend/components/Explorer.tsx
  - src/frontend/explorer-store.ts
  - src/frontend/components/v2/ExplorerRail.tsx
  - src/frontend/layout-store.ts
documentation:
  - docs/v2-architecture.md
ordinal: 85000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Explorer's rail gains a Backlog section when the task's repository is a Backlog.md project (the route from TASK-84 says so; the rail item is absent otherwise, not disabled). The panel is a list of the repository's tasks in the order Backlog.md shows them, split at the top into two tabs, Open and Closed. Open holds every task whose status is not the terminal one (the last configured status, Done here) under a section header per status with the most active first — In Progress above To Do; a configuration with more statuses lists them in reverse configured order, terminal excluded. Closed holds the terminal status, including files under backlog/completed. Each card shows the id and the title, with priority and labels as small chips when present; keep it to a row that reads at the panel's width, composed from components/v2 with the semantic tokens. Clicking a card opens the task's .md in a file tab exactly as the Files section would open it — the same { kind: 'file', path } tab through the layout store, so a markdown file lands in preview mode, single click previews and a card already open focuses its tab rather than duplicating. The Open/Closed choice survives closing and reopening the panel, per device, alongside the other Explorer state in explorer-store. The list is live enough to be trusted: it is fetched when the section shows and refreshed while it stays showing, so a task the agent just filed or closed appears without a reload; the mechanism (a poll while visible, or a watcher pushing over the socket) is the implementer's call, but a poll must stop when the section is hidden.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The rail shows a Backlog item only when GET /api/tasks/:id/backlog reports detected, and the item is absent otherwise
- [ ] #2 Open lists non-terminal tasks under one header per status, In Progress above To Do, in Backlog.md's order; Closed lists terminal-status tasks including backlog/completed
- [ ] #3 Clicking a card opens the task's .md through the same file tab the Files section opens, so it renders in markdown preview; a second click focuses the open tab
- [ ] #4 The Open/Closed tab is remembered per device with the rest of the Explorer state
- [ ] #5 A task filed or moved while the section is showing appears without a reload, and the refresh stops when the section is hidden
- [ ] #6 Rendering tests cover the grouping, the ordering, the click, and the absent rail item
<!-- AC:END -->
