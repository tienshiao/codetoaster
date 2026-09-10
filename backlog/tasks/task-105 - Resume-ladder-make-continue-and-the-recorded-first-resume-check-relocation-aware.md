---
id: TASK-105
title: >-
  Resume ladder: make --continue and the recorded-first resume check
  relocation-aware
status: To Do
assignee: []
created_date: '2026-09-10 21:27'
labels: []
dependencies: []
ordinal: 105000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up from TASK-104's review. Two residual relocation gaps remain in the resume ladder after a mid-session worktree switch. (1) continueIsSafe reads listTranscripts(transcriptDirFor(task)) — the stale transcript_path folder — so it refuses a valid --continue rung that would open the correct conversation from the current cwd; conservative (a missed fallback, never a wrong resume). (2) canResumeSessionId returns true on finding the file in the recorded folder before consulting projectsDirFor(cwd), but claude --resume reads only the cwd-derived project folder, so a row whose transcript_path still names a folder holding the file while cwd maps elsewhere could approve a doomed rung; pre-existing, predates TASK-104. Resolving (2) needs a verified answer to where claude --resume looks up a session id: strictly projectsDirFor(cwd), or by the session's own recorded location.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 continueIsSafe considers the cwd-derived folder after a relocation so a valid --continue rung is not dropped
- [ ] #2 The order/preference of recorded vs cwd-derived folder in canResumeSessionId is settled against verified claude --resume lookup behavior, with the doomed-rung risk closed or documented
- [ ] #3 Tests cover both relocation cases
<!-- AC:END -->
