---
id: TASK-36
title: One-time migration of v1 projects
status: To Do
assignee: []
created_date: '2026-08-29 00:03'
labels:
  - server
  - db
milestone: m-5
dependencies:
  - TASK-1
documentation:
  - docs/v2-architecture.md
ordinal: 36000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
§10 Phase 6: existing v1 users have a projects table without the new default columns. Fill sensible defaults (worktree_default=false, base ref from the repo's current branch or HEAD, model/permission mode null = Claude Code's own defaults). v1 sessions are dropped by design (§2) — no attempt to convert them into tasks.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Existing projects get defaults populated on first v2 boot without user action
- [ ] #2 The migration runs exactly once
- [ ] #3 A note in the README explains that v1 sessions are not carried over
<!-- AC:END -->
