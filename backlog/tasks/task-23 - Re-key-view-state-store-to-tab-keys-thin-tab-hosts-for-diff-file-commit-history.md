---
id: TASK-23
title: >-
  Re-key view-state-store to tab keys; thin tab hosts for
  diff/file/commit/history
status: To Do
assignee: []
created_date: '2026-08-29 00:03'
labels:
  - frontend
milestone: m-3
dependencies:
  - TASK-18
documentation:
  - docs/v2-architecture.md
ordinal: 23000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
view-state-store.ts survives but is keyed by tab key instead of session id (§7.4); helpers (pruneSet, toggleInSet, withAll, pruneComments) carry over unchanged. GitViewState/DiffViewState shrink to per-tab shapes. DiffView.tsx / FileView.tsx / GitView.tsx become thin hosts that render DiffLayout / file content / CommitDetail for one descriptor. New tab kinds: diff (one working-tree file), diffAll, file (with optional line), commit (sha), history.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 View state is stored and pruned per tab key; closing a tab drops its state
- [ ] #2 Each TabDescriptor kind renders the matching existing component without duplicating its logic
- [ ] #3 Scroll offsets, expanded paths, hunk expansions, and comments survive switching tabs and reloads
- [ ] #4 Existing diff/file/git component tests pass unchanged
<!-- AC:END -->
