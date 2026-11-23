---
id: TASK-153
title: Refresh CLAUDE.md for the v2 layout
status: Done
assignee:
  - '@claude'
created_date: '2026-11-23T13:52:00Z'
updated_date: '2026-11-23T13:57:00Z'
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
- [x] #1 Every file and directory path named in CLAUDE.md exists on v2
- [x] #2 The project structure covers the current top-level modules under src/lib, src/api and src/frontend
- [x] #3 The WebSocket protocol section matches the message types in src/lib/xtmux/types.ts, or points at that file as the source of truth
- [x] #4 Key Patterns describes tasks and the t.$slug route rather than the removed session routes, and drops patterns that no longer apply
- [x] #5 Rules and conventions sections (testing, Bun, v2 design system, wiki, Backlog) are unchanged except for stale paths
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Survey src/ and the message unions in src/lib/xtmux/types.ts for the current layout and protocol. 2. Rewrite the intro, Project Structure, WebSocket Protocol and Key Patterns sections of CLAUDE.md for tasks, the t.$slug route and the tab layout, linking wiki pages instead of repeating them. 3. Fix the stale tense in the v2 design system section (TASK-28 is done, routes/shell.tsx is gone) without changing its rules. 4. Check every backticked path in CLAUDE.md exists with a script. 5. Run wiki-links test, update wiki pages that cite CLAUDE.md for removed facts, append wiki/log.md.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Path check (scratchpad script over every backticked path, markdown link and tree entry): 93 checked, 0 stale; the remaining hits are bare filenames in prose (naming.ts, drag.ts, parseDiff.ts and others), each found under src/, plus suffix patterns like .test.ts. Before the edit it flagged App.tsx, SessionContext.tsx, FileView.tsx, routes/shell.tsx and the sessions.$slug route files. AC5: the only edits outside intro, structure, protocol and Key Patterns are in the v2 design system section, whose Status described TASK-28 as pending and whose components/ui rule referred to live v1 code; the rule itself (do not grow it) is kept.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
CLAUDE.md now describes the app as it stands on v2. The intro describes tasks and agents rather than a shell multiplexer. The project structure drops App.tsx, SessionContext.tsx and FileView.tsx and adds lib/tasks, lib/agent, lib/worktree, lib/backlog, lib/diff, frontend/lib, the tab panes and src/types. The WebSocket section points at ClientMessage and ServerMessage in src/lib/xtmux/types.ts as the source of truth, with an outline that notes task lifecycle actions are HTTP routes under /api/tasks. Key Patterns covers the /t/$slug route with ?tab=, the per-task tab layout, per-PTY frame routing and the activity edge, and links the wiki pages for naming, size negotiation, list order and compression. The v2 design system section no longer treats TASK-28 as pending. The wiki page The v2 design system and its index entry were brought in line and wiki/log.md appended. Verification: a script checked 93 path tokens in CLAUDE.md, none stale (10 before the edit); wiki-links.test.ts passes. Docs only, so no code review or runtime verify.
<!-- SECTION:FINAL_SUMMARY:END -->
