---
id: TASK-133
title: Clicking a terminal tab gives its terminal the caret
status: Done
assignee:
  - '@claude'
created_date: '2026-10-28T17:16:00Z'
updated_date: '2026-10-28T17:22:00Z'
labels:
  - frontend
dependencies: []
type: bug
ordinal: 135000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Clicking the agent tab (or a shell tab) in the strip brings it forward but leaves focus on the tab button, so the user has to click into the terminal before typing. Only the keyboard chords (onFocusPane in TaskShell) send the focus pulse; TabArea's tab onClick only calls focusTab on the layout.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Clicking a terminal tab in the strip focuses that tab's terminal
- [x] #2 Clicking a non-terminal tab keeps its current behaviour
- [x] #3 A render test covers a terminal-tab click raising the focus request, and a non-terminal click not raising it
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. TabArea: new onFocusTerminal prop fired from a tab's onClick after focusTab, for terminal tabs only. 2. TaskShell: wire it to pulseTab, the same pulse the keyboard chord uses. 3. TabArea render test. 4. Verify in a browser on an isolated server.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A click on a terminal tab (agent or shell) now raises the same focus pulse the focus chord does, so the grid takes the caret and typing goes straight to the PTY. TabArea gained onFocusTerminal, fired after focusTab for terminal tabs only; TaskShell wires it to pulseTab. Diff and file tab clicks are unchanged. Test: TabArea.render.tsx covers agent and shell clicks reporting the tab and a file-tab click not. bun run test and bun run typecheck clean. Code review (low): no findings. Verify: isolated server on 4599 with a shell task, opened a backlog file tab, clicked Agent, typed without clicking the grid, and the text landed at the shell prompt.
<!-- SECTION:FINAL_SUMMARY:END -->
