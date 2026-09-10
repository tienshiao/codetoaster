---
id: TASK-104
title: >-
  A task that switched worktrees mid-session cannot be resumed: stale
  transcript_path
status: Done
assignee: []
created_date: '2026-09-10 19:30'
updated_date: '2026-09-10 21:26'
labels: []
dependencies: []
ordinal: 104000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When a session switches worktrees mid-flight, Claude Code relocates its conversation transcript into the project folder for the new cwd (its own 'relocated' records). The task row's transcript_path, written from the SessionStart before the move, keeps naming the folder the file left. Every resume-ladder rung derives its search directory from that path via transcriptDirFor, so it searches an empty folder, declines the conversation, and the ladder ends in could_not_resume even though the conversation is on disk one directory over. Observed live: a task moved from a composer-project-first worktree into list-order-hover-refresh could not be restored. Fix transcriptDirFor to fall back to the cwd-derived project directory when the recorded transcript file no longer exists, which is where the relocation put it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 canResumeSessionId finds a conversation that was relocated to the cwd-derived directory, so the resume ladder offers --resume for it
- [x] #2 bun run test:unit and bun run test:render pass, typecheck clean
- [x] #3 canResumeSessionId, when the recorded transcript folder is readable but no longer holds the conversation, also checks projectsDirFor(cwd) and returns true if the transcript is there; unreadable-folder and null transcript_path behavior is unchanged
- [x] #4 New transcripts.test.ts tests cover relocation recovery and the doomed-rung guard, plus an end-to-end resume.test.ts test asserting the ladder invokes --resume with the stored id; pre-existing transcript tests still pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Localize the fix to canResumeSessionId (the stored-id resume rung), not transcriptDirFor. Keep transcriptDirFor pure: redirecting it to the cwd-derived folder discards the readable recorded folder's signal and reintroduces a doomed --resume rung (caught by the existing 'a conversation older than the task' resume test). In canResumeSessionId keep the original short-circuits (unreadable/not-a-directory recorded folder still returns true), then additively: when the recorded folder is readable and lacks the id, also check projectsDirFor(cwd) and return true only if a different, readable folder actually holds the transcript. This resumes the exact stored id wherever the relocation moved it, and cannot resurrect a doomed rung because it is a stat, not a spawn.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Validation: transcripts.test.ts and resume.test.ts green (53 tests). Full unit suite 1486 pass, 2 fail; both failures are pre-existing and unrelated (src/cli/hook.test.ts daemon-HTTP tests that fail identically on the pristine baseline before this change). Render suite 324 pass. tsc --noEmit clean. Root cause verified live on the stuck task (session 65d02143): row transcript_path named the composer-project-first project folder while Claude Code had relocated the transcript into the list-order-hover-refresh folder matching the current cwd; the stuck row's transcript_path was also repointed by hand so it can resume immediately.

Post-review (/code-review of the resume fix): applied Finding 1 — the reported-transcript rung in manager.ts now gates on canResumeSessionId(row, reported) instead of transcriptExists(row.transcript_path), so both id-based resume rungs are relocation-aware through one helper; added a resume.test.ts case for the compound stale-stored-id + relocation scenario. Applied Finding 4 — the transcripts.test.ts 'stays off' test now creates projectsDirFor(cwd) with a stranger so it exercises the present-but-empty-of-ours branch. Deferred Findings 2 (continueIsSafe is relocation-blind; conservative, only a missed --continue fallback) and 3 (recorded-first check can approve a doomed rung; pre-existing, not introduced here) to a follow-up. Finding 5 (tests mkdir under real ~/.claude/projects) is the pre-existing plantTranscripts convention. Re-verified: transcripts+resume 55 pass, full unit 1487 pass / 2 pre-existing unrelated hook failures, tsc clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
canResumeSessionId now falls back to projectsDirFor(cwd) when the recorded transcript folder is readable but no longer holds the conversation, recovering tasks whose transcript Claude Code relocated on a mid-session worktree switch. transcriptDirFor stays pure so the readable-recorded-folder signal (and the guard against doomed --resume rungs) is preserved. Added two unit tests and one end-to-end resume test.
<!-- SECTION:FINAL_SUMMARY:END -->
