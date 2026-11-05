---
id: TASK-142
title: Evict symbol indexes for directories and commits nobody is browsing
status: To Do
assignee: []
created_date: '2026-11-05T09:20:00Z'
labels:
  - backend
dependencies: []
ordinal: 146000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The symbol store (src/lib/symbols/store.ts) keeps one index per directory and one per commit in module-level maps that are never evicted. Go-to-definition and symbol search in a directory builds a full index for it, and TASK-138.2 made that reachable for every subagent worktree a user browses: each one stays in daemon memory after the worktree is removed, so the daemon grows with every worktree, project and commit ever looked at. Raised by the TASK-138.2 code review; project directories and commits have the same gap.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An index for a directory that no longer exists is dropped the next time the store is consulted or swept
- [ ] #2 Indexes not used for a configurable idle period are evicted, with the clock injected
- [ ] #3 The number of commit indexes held at once is bounded, least recently used evicted first
- [ ] #4 A lookup after eviction rebuilds the index and answers the same as before
- [ ] #5 The store's index count and size show in GET /api/diagnostics
- [ ] #6 Unit tests cover the removed-directory, idle and commit-bound cases
<!-- AC:END -->
