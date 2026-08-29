---
id: TASK-18
title: 'layout-store: tab descriptors, groups, persistence'
status: To Do
assignee: []
created_date: '2026-08-29 00:02'
labels:
  - frontend
milestone: m-3
dependencies: []
documentation:
  - docs/v2-architecture.md
priority: high
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
frontend/layout-store.ts (§7.2): TabDescriptor union (agent | shell | diff | diffAll | file | commit | history), `tabKey()` for dedupe/focus, TabState with preview flag, TabGroup { id, tabs, activeTabId, flex }, TaskLayout { groups, activeGroupId }. Flat row of groups, not a recursive grid. Persisted per task id in localStorage. Operations: open (dedupe via tabKey; preview replaces preview), pin, close, move between groups, split, reorder, focus.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 tabKey is stable for equal descriptors and distinct for different ones
- [ ] #2 Opening a descriptor whose key is already open focuses the existing tab
- [ ] #3 A single-click open creates a preview tab that the next preview open replaces; pin makes it permanent
- [ ] #4 The agent tab always exists, is unique, and cannot be closed
- [ ] #5 Split is refused for agent and shell tabs; a terminal never appears in two groups
- [ ] #6 Layout round-trips through localStorage keyed by task id and survives reload
- [ ] #7 Pure functions with unit tests for every operation
<!-- AC:END -->
