---
id: TASK-86
title: Task ids in a task's terminals are links that open the task file
status: Done
assignee:
  - '@tma'
created_date: '2026-09-04 21:37'
updated_date: '2026-09-04 22:11'
labels:
  - frontend
  - terminal
  - backlog
dependencies:
  - TASK-84
references:
  - src/frontend/Terminal.tsx
  - src/frontend/components/tabs/panes/AgentPane.tsx
  - src/frontend/layout-store.ts
ordinal: 86000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
An agent working a Backlog.md repository names tasks constantly — 'filed TASK-82', 'closing TASK-78' — and the user reads those in the Agent tab with no way to get from the id to the file. When the task's repository is a Backlog.md project (the route from TASK-84), every occurrence of an id in the task's terminals becomes a link: hovering underlines it the way xterm's web links are underlined, and activating it opens the task's .md in a file tab exactly as a card in the Explorer's Backlog section does — the same { kind: 'file', path } tab through the layout store, markdown preview and focus-if-open included. The prefix comes from the route (the uppercased task_prefix as ids are written in files, TASK here), not from a hard-coded name, and the id is matched as a whole word so TASK-8 does not light up inside TASK-82. An id the list does not know — a task not yet filed, or one in backlog/archive — is not a link. Implemented as an xterm ILinkProvider registered on the terminal beside the web links addon, in a module of its own so the matcher is testable without a DOM; activation follows the same modifier convention the web links addon uses in this app (check what Terminal.tsx configures before choosing click or modifier-click, and match it). Applies to the agent's terminal and to shell tabs alike: both are the task's terminals and the shell runs the same CLI.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 In a Backlog.md repository, a whole-word task id in the agent's terminal or a shell tab is underlined on hover and opens the task's .md in a file tab in markdown preview when activated, focusing the tab if it is already open
- [x] #2 The prefix is the one the route reports, TASK-8 is not matched inside TASK-82, and an id the list does not know is not a link
- [x] #3 Outside a Backlog.md repository nothing is matched and no provider is registered
- [x] #4 The matcher has unit tests; the link provider's registration and activation have a test at the level the existing Terminal tests allow
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. utils/backlog-links.ts: indexBacklog(response) → { prefix, paths }, findBacklogLinks(line, index) whole-word matcher (case-insensitive, uppercased lookup, unknown ids skipped), createBacklogLinkProvider(terminal, getIndex, onOpen) → xterm ILinkProvider with underline + pointer decorations; activation on plain click, matching the web-links addon's default here.
2. Terminal.tsx: linkProvider?: (term) => ILinkProvider prop, registered once the grid exists and disposed on change/unmount; no provider when the prop is absent.
3. hooks/use-backlog-links.ts: builds the provider from useBacklog (15s poll while visible), reading the latest index through a ref so the registration is stable; TabPane hands it to AgentPane and ShellPane, which pass it to XTerminal. Activation opens { kind: 'file', path } as a permanent tab.
4. Tests: backlog-links.test.ts (bun) for the matcher and the provider over a fake buffer; TabPane.render.tsx captures XTerminal's props and asserts registration/absence and activation.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Matcher and provider in utils/backlog-links.ts (DOM-free); XTerminal takes a linkProvider factory registered once the grid exists; hooks/use-backlog-links.ts builds it from useBacklog (15s poll while the tab is visible) and reads the current index through a ref so a poll never re-registers. Activation is a plain click, matching the web-links addon's default here, and opens a permanent tab. Validation: backlog-links tests (14), TabPane render tests (3), full suite green; verified in Chrome: TASK-82, (TASK-8) and lowercase task-33 underline and open the file, TASK-999 and xTASK-84 do not.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Task ids in the agent's terminal and shell tabs are xterm links when the repository is a Backlog.md project: whole-word, prefix from the route, unknown ids skipped, click opens the task's .md in a file tab and focuses it if open. Verified with unit and rendering tests and in the browser.
<!-- SECTION:FINAL_SUMMARY:END -->
