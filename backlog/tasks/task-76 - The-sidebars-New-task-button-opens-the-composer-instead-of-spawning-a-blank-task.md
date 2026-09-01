---
id: TASK-76
title: >-
  The sidebar's New task button opens the composer instead of spawning a blank
  task
status: Done
assignee:
  - '@claude'
created_date: '2026-09-01 17:19'
updated_date: '2026-09-01 17:33'
labels:
  - frontend
dependencies: []
ordinal: 76000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The + in the task list header calls createTask({cols, rows}) directly: it spawns a promptless agent into whichever project resolves (general), with no chance to pick the project, model, permission mode or worktree. The composer at / already carries all of those controls (§7.5), so the button should take the user there and put the cursor in the prompt. Promptless tasks stay possible over HTTP/CLI; the docs and comments that name the sidebar button as the promptless case are updated to name the API instead.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Clicking New task in the sidebar navigates to / and focuses the composer prompt; no task is created
- [x] #2 Clicking New task while already on / focuses the prompt
- [x] #3 The composer's prompt is focused on mount
- [x] #4 docs/v2-architecture.md and the titleFromPrompt comments no longer attribute promptless tasks to the sidebar button
- [x] #5 A rendering test covers the button's navigation and that createTask is not called
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. hooks/use-task-nav.ts: add useOpenComposer() — navigate to '/', then focus the composer prompt by id once the navigation settles. 2. Composer.tsx: give the Textarea a stable id (export COMPOSER_PROMPT_ID) and autoFocus. 3. TaskShell.tsx: pass onNewTask: useOpenComposer() into useTaskSidebar; TaskSidebar.tsx takes it as an option and passes it through instead of calling createTask. 4. Update TaskShell.render.tsx's use-task-nav mock; add a rendering test for the sidebar button. 5. docs/v2-architecture.md §7.5 and titleFromPrompt comments: the promptless case is the API/CLI, not the button.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
The navigation lives in hooks/use-task-nav.ts as useOpenComposer, next to useOpenTask, and TaskShell injects it into useTaskSidebar the same way it injects onSelectTask — the sidebar hook knows tasks, not addresses, so it no longer touches createTask at all. COMPOSER_PROMPT_ID is exported from the nav hook (Composer already imports from it; the reverse import would be a cycle). Focus is applied after the navigation promise resolves, which covers the press while / is already showing, and the Textarea autoFocuses for the mount case. Promptless tasks remain possible over POST /api/tasks; docs §7.5, derive.ts and derive.test.ts now name that path instead of the button. Validation: tsc clean; vitest 19 files / 151 tests pass; bun test 977 pass, 0 fail (one earlier run exited 1 with no failing test printed and did not reproduce on two reruns).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The sidebar's + navigates to / and focuses the composer prompt instead of spawning a promptless task into the general project, so project, model, permission mode and worktree are chosen in the composer before anything starts. New useOpenComposer hook, Composer textarea addressed by id and autofocused, sidebar hook takes onNewTask from TaskShell. Two new render tests (navigation + focus) and one pass-through test; docs and comments updated. Not verified in a browser — the behaviour is a navigation plus focus, both under test.
<!-- SECTION:FINAL_SUMMARY:END -->
