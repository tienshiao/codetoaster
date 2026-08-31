---
id: TASK-60
title: >-
  Reinstate the transcript-scan resume rung once worktrees make the directory
  the task's own
status: To Do
assignee: []
created_date: '2026-08-31 01:37'
labels:
  - server
  - agent
milestone: m-4
dependencies:
  - TASK-29
documentation:
  - docs/v2-architecture.md
ordinal: 60000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-43 corrected `continueIsSafe` so `--continue` is offered only when the newest transcript in the directory is one we can name as the task's — the path its SessionStart reported, or the id we minted for it. That made §4.3's last rung, the scan (`findResumableTranscript`), unreachable-or-wrong, so `resumeLadder` now stops one rung short and documents why: if the guard passed, the newest transcript is ours and rungs 1-3 already offered it, so the scan can only reach past it to something older that nothing has shown to be ours; if the guard failed, the scan has to be refused for the same reason the guard was.

What that costs is the case §4.3 wanted it for: a degraded task (hooks never arrived, so no SessionStart set transcript_path) whose agent then ran /clear, leaving its real conversation under an id we were never told. In a shared directory that conversation is indistinguishable from a stranger's and an mtime window is not a distinction.

A worktree is the distinction: one directory, one task, one conversation. Once TASK-29 lands, a task whose cwd is its own worktree can take the newest in-window transcript there without naming it first, because there is nothing else it could be. The rung should come back gated on that — the task being in a worktree we created — and not on the mtime window alone.

`findResumableTranscript` and its tests were kept in src/lib/agent/transcripts.ts for this.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The scan rung is on the ladder again for a task whose cwd is a worktree codetoaster created, and stays off for one running in a shared directory
- [ ] #2 The gate is worktree provenance, not the mtime window alone; a task in a plain cwd is unchanged by this task
- [ ] #3 A test covers a degraded task in a worktree recovering a conversation under an id that was never reported
- [ ] #4 A test covers the same shape in a non-worktree cwd still refusing to guess
<!-- AC:END -->
