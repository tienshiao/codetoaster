---
id: TASK-43
title: continueIsSafe lets rung 3 open a stranger's conversation
status: To Do
assignee: []
created_date: '2026-08-29 09:05'
labels:
  - server
  - agent
  - bug
dependencies: []
ordinal: 43000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by code review during TASK-14 (not introduced by it).

src/lib/agent/transcripts.ts:112 — continueIsSafe returns true for a row with no transcript_path. But rung 3 of the resume ladder is only reached after rung 1 has proved the minted session id has no transcript, so at that point --continue can only open whatever the most recent conversation in that directory is: someone else's. Its SessionStart then binds the task to that conversation permanently.

This contradicts the guard's own stated purpose at manager.ts:642. Not fixed in review because the fix removes a fallback rung from the resume ladder, which is a documented design decision (§4.3) rather than a bug to patch silently.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The no-transcript_path case can no longer reach --continue, or the ladder documents why it is safe to
- [ ] #2 A test covers a task whose stored id has no transcript and a foreign conversation exists in the same directory
<!-- AC:END -->
