---
id: TASK-140
title: Take Close off the task row; keep it in the palette as Suspend now
status: Done
assignee:
  - '@claude'
created_date: '2026-11-05T07:32:00Z'
updated_date: '2026-11-05T09:54:00Z'
labels:
  - frontend
dependencies: []
ordinal: 144000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The sidebar row's Close button suspends the task at once: it kills the agent and shells, keeps scrollback and worktree, and resumes on open. The harvester already does this by itself after 30 idle minutes with no viewer, so the button offers no workflow value, and its name makes it read like something final, which leaves users unsure what it does or why they would use it. It is still useful occasionally, to free memory now or stop a runaway agent, so it moves to the command palette under a name that says what it does.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Task rows in the sidebar no longer show a Close button
- [x] #2 The command palette offers Suspend now for a live task, and its description says the task resumes when opened
- [x] #3 Suspending a busy task from the palette still asks for confirmation first
- [x] #4 Docs and the wiki that mention closing a task from the sidebar describe the palette action instead
- [x] #5 Rendering tests cover the row without Close and the palette entry
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Remove the X from TaskRowActions with the busy and onClose props only it used. 2. The palette's close entry becomes Suspend now with the detail resumes when opened and close and stop as keywords; its confirmation for a busy task reads Suspend this task. 3. Update the architecture doc and README. 4. Tests: the row without Close, the palette entry, the busy confirmation.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Code review (high, with fix) raised 8 findings; 6 fixed: deleting the row tests had left the busy confirmation untested (the palette test now covers idle suspending at once and busy asking first), the dialog's new wording had no test, the README's palette list and escape-hatch line still said close, two stale comments, CloseTaskDialog renamed SuspendTaskDialog, stale test labels. Left: the confirm button stays destructive, since interrupting a working agent does lose its in-progress turn; internal names (the close-task action, closeTask) keep the old word, which reaches into the server for no user-visible gain.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Task rows in the sidebar no longer carry a Close button; they keep rename and archive. Suspending now lives in the command palette as Suspend now, described as resuming when opened and still found by typing close, and a busy task still asks first in a dialog titled Suspend this task. The architecture doc and README describe the palette action. Review: 6 of 8 findings fixed, see notes. Verified on an isolated server in Chrome: a task row showed only Rename and Archive; with a shell task printing in a loop (busy), the palette search close found Suspend now, choosing it opened the Suspend this task confirmation, and confirming suspended the task. Typecheck clean; vitest 594 pass; bun test 2164 pass with the known broadcasting timeout under the full run.
<!-- SECTION:FINAL_SUMMARY:END -->
