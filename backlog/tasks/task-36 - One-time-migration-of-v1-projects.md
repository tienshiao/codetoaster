---
id: TASK-36
title: One-time migration of v1 projects
status: Done
assignee:
  - '@claude'
created_date: '2026-08-29 00:03'
updated_date: '2026-09-05 07:00'
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
- [x] #1 Existing projects get defaults populated on first v2 boot without user action
- [x] #2 The migration runs exactly once
- [x] #3 A note in the README explains that v1 sessions are not carried over
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Finding: migration 004 (Phase 1) already adds the default columns with worktree_default=0 and NULL for base ref, model and permission mode, and applied_migrations guarantees a single run. v1 sessions were in-memory, so the database file is the only thing that carries over. No new migration.
2. Base ref stays NULL rather than snapshotting the repo's current branch: createTask resolves NULL as HEAD at task time, which follows whatever the user has checked out, whereas a branch stored at migration time goes stale and initial_path may be ~-prefixed or not a repo.
3. db.test.ts: assert an upgraded v1 project row reads worktree_default=0 and NULL defaults, and that the defaults migration is recorded so it does not run again.
4. README: an 'Upgrading from v1' note — projects carry over, sessions do not.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
No new migration: 004_project_task_defaults already fills the defaults and applied_migrations records it, so an upgraded database is migrated once on first boot. Added a db.test.ts case that seeds the v1 schema, asserts the defaults on an upgraded project row, then configures the project and re-applies migrations to prove it is not reset. Validation: bun test src/lib/db.test.ts, 17 pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Verified the v1 project migration path rather than adding to it: migration 004 populates worktree_default=0 and NULL base ref/model/permission mode on first v2 boot, recorded so it runs once. Base ref stays NULL by design (resolved as HEAD at task creation, not snapshotted). Pinned with an upgrade test in db.test.ts and added an 'Upgrading from v1' README section saying projects carry over and sessions do not.
<!-- SECTION:FINAL_SUMMARY:END -->
