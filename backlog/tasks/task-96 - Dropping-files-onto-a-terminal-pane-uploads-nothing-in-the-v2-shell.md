---
id: TASK-96
title: Dropping files onto a terminal pane uploads nothing in the v2 shell
status: Done
assignee:
  - '@claude'
created_date: '2026-09-07 22:08'
updated_date: '2026-09-07 22:21'
labels:
  - frontend
  - bug
dependencies: []
ordinal: 100000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Dragging a file over an agent or shell terminal still shows the 'Drop files to upload' overlay, but nothing happens on drop: XTerminal's onFileDrop is not passed by anything in the v2 shell (v1's App.tsx wired it to useUploadFiles, and that wiring went with App.tsx in 8822338). The server route POST /api/tasks/:id/upload still exists and writes the staged paths into the task's primary PTY (the agent). A drop on a shell tab should type the paths into that shell's PTY, not the agent's.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Dropping one or more files onto the agent terminal stages them under the uploads directory and types their quoted paths into the agent's PTY
- [x] #2 Dropping files onto a shell tab's terminal types the paths into that shell's PTY
- [x] #3 A failed upload is reported to the user rather than swallowed
- [x] #4 A drop on a task whose terminal is gone does nothing harmful
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Let POST /api/tasks/:id/upload take an optional ptyId (a shell of the task) and write the paths into that PTY, defaulting to the primary. 2. In TaskShell, pass an onFileDrop to AgentPane and ShellPane that posts the files with the pane's ptyId and surfaces a failure. 3. Verify with a synthetic drop in the browser against an isolated server.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Moved POST /api/tasks/:id/upload from server.ts into api/uploads.ts (uploadRoutes) so it is testable; it now takes ?pty=<id>, resolved among the task's own primary and shell PTYs (another task's PTY is a 404, nothing written). New use-terminal-drop.tsx: useTerminalDrop(taskId, ptyId) posts the drop to that PTY and surfaces a failure as a transient pill over the bottom of the grid (auto-dismiss 8s, or ✕); a null ptyId fails locally without a request. AgentPane and ShellPane both use it; ShellPane gained taskId from TabPane. use-upload-mutation.ts loses the unused react-query mutation and shares one response-to-paths helper with uploadStaged. Route tests: src/api/uploads.test.ts (6 pass). Browser: synthetic drops on the agent pane and a shell tab each typed the quoted path into the right PTY and staged the file; a forced 404 showed 'Upload failed  That terminal is gone'.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Dropping files on an agent or shell terminal works again in v2: the pane uploads them to the task's staging directory and the server types the quoted paths into the PTY they were dropped on. Failures are shown in the pane. Route covered by tests; verified in Chrome.
<!-- SECTION:FINAL_SUMMARY:END -->
