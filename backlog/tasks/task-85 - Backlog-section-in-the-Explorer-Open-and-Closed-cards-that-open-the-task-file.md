---
id: TASK-85
title: >-
  Backlog section in the Explorer: Open and Closed, cards that open the task
  file
status: Done
assignee:
  - '@tma'
created_date: '2026-09-04 21:37'
updated_date: '2026-09-04 22:11'
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
- [x] #1 The rail shows a Backlog item only when GET /api/tasks/:id/backlog reports detected, and the item is absent otherwise
- [x] #2 Open lists non-terminal tasks under one header per status, In Progress above To Do, in Backlog.md's order; Closed lists terminal-status tasks including backlog/completed
- [x] #3 Clicking a card opens the task's .md through the same file tab the Files section opens, so it renders in markdown preview; a second click focuses the open tab
- [x] #4 The Open/Closed tab is remembered per device with the rest of the Explorer state
- [x] #5 A task filed or moved while the section is showing appears without a reload, and the refresh stops when the section is hidden
- [x] #6 Rendering tests cover the grouping, the ordering, the click, and the absent rail item
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. explorer-store: add Backlog to EXPLORER_SECTIONS and backlogTab ('Open' | 'Closed', default Open) to ExplorerState; revive tolerates a stored state without it.
2. hooks/use-backlog.ts (shared with TASK-86): react-query over /api/tasks/:id/backlog, per-observer refetchInterval.
3. useExplorerRail adds the Backlog item only when detected === true; TaskShell falls back to Changes when the stored section is Backlog and detected === false.
4. components/BacklogSection.tsx: ExplorerTabs Open/Closed, a header per non-terminal status in reverse configured order, cards (id, title, priority and label Badges) that call the preview open with { kind: 'file', path }; polls at 3s while mounted.
5. Markdown file tabs default to preview (view-state-store) so the card lands on rendered markdown.
6. Rendering tests: BacklogSection (grouping, ordering, click, tab memory) and the rail item's absence.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Section in components/BacklogSection.tsx, polled at 3s through react-query's per-observer refetchInterval so the poll ends when the Explorer unmounts the section. Explorer note components moved to components/explorer-notes.tsx to avoid an import cycle. The stored section falls back to Changes only once the route has said detected: false. Markdown file tabs now default to preview (view-state-store) so a card lands on rendered markdown; that changes the Files section too. Card chips sit on a second line: beside the title at 272px they left the title reading as one letter. Validation: explorer-store tests (15), BacklogSection and TaskShell render tests (22), full suite green; verified in Chrome against this repo: rail item appears, In Progress above To Do, Closed holds Done, a card opens the .md in preview, a second click focuses it, the tab choice survives a reload.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The Explorer gains a Backlog section (rail item only when the route reports detected) with Open/Closed tabs remembered per device, one header per non-terminal status in reverse configured order, and cards that open the task's .md through the same preview file tab the Files section uses. Verified with rendering tests and in the browser.
<!-- SECTION:FINAL_SUMMARY:END -->
