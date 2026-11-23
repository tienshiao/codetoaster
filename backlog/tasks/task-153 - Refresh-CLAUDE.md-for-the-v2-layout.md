---
id: TASK-153
title: Refresh CLAUDE.md for the v2 layout
status: To Do
assignee: []
created_date: '2026-11-23T13:52:00Z'
labels:
  - docs
dependencies: []
priority: medium
ordinal: 156000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
CLAUDE.md is loaded into every agent session, and parts of it still describe the app before the v2 rebuild (TASK-28 and after). The project structure lists src/frontend/App.tsx, SessionContext.tsx and FileView.tsx, which no longer exist, and leaves out src/lib/tasks, src/lib/agent, src/lib/worktree and most of src/api. Key Patterns describes session routes as sessions.$slug.tsx with index, diff, file and git children, while the routes are now __root.tsx, index.tsx and t.$slug.tsx. The WebSocket Protocol section lists only the session-era messages and misses task, tasks, acknowledge, reorder, the project messages, changed, notification, load and loadHistory. Agents start every task from this file, so stale paths send them looking for code that is gone. Fixing the code is out of scope; where the wiki already explains a subsystem, CLAUDE.md should point to it rather than repeat it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every file and directory path named in CLAUDE.md exists on v2
- [ ] #2 The project structure covers the current top-level modules under src/lib, src/api and src/frontend
- [ ] #3 The WebSocket protocol section matches the message types in src/lib/xtmux/types.ts, or points at that file as the source of truth
- [ ] #4 Key Patterns describes tasks and the t.$slug route rather than the removed session routes, and drops patterns that no longer apply
- [ ] #5 Rules and conventions sections (testing, Bun, v2 design system, wiki, Backlog) are unchanged except for stale paths
<!-- AC:END -->
