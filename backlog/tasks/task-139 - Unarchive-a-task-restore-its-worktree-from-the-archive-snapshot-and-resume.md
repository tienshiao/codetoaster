---
id: TASK-139
title: 'Unarchive a task: restore its worktree from the archive snapshot and resume'
status: Done
assignee:
  - '@claude'
created_date: '2026-11-05T07:32:00Z'
updated_date: '2026-11-05T09:44:00Z'
labels:
  - frontend
  - backend
dependencies: []
ordinal: 143000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Archive is the only way to put a task away, and it cannot be undone from the UI, so it is hard to commit to when you are not sure the work is finished. Archive already keeps what a restore needs: it snapshots the worktree, uncommitted changes included, to a refs/codetoaster/wip ref retained for 30 days, and keeps the branch unless it was merged or pushed (TASK-31, TASK-38). What is missing is the way back. Evicted tasks already get their checkout rebuilt on open (TASK-39), which is the closest existing path. Chosen over adding a separate Done or Settle state: with a reliable unarchive, archive itself becomes safe to use when you think you are done.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An archived task in the sidebar's archived list and in the command palette offers Unarchive
- [x] #2 Unarchive recreates the task's worktree on its branch with the snapshot's uncommitted changes applied, then resumes the agent, and the task returns to the live list
- [x] #3 A task that ran in the project directory rather than its own worktree unarchives by resuming only
- [x] #4 When the snapshot has expired or the branch is gone, Unarchive says what can and cannot be restored before doing anything, and restores what it can
- [x] #5 The archive confirmation says the task can be unarchived and until when
- [x] #6 The unarchive route has route-level tests: happy path, unknown task 404, task not archived 409, and the expired-snapshot case
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. TaskManager.unarchivePreview(taskId): null unless archived; reports the checkout outcome (none for a task with no worktree, restore when the branch exists, recreate from the snapshot parent, from origin, or from the base ref with the work lost) and the snapshot (kept with its expiry from wip_at plus WIP_RETENTION_MS, expired, or none). 2. TaskManager.unarchiveTask(taskId, size): serialized against in-flight archive, resume and evict like the other lifecycle operations; recreates a deleted branch as the preview said, flips the row to suspended (worktree_state stays evicted), broadcasts, then returns resumeTask, which restores the checkout from the branch and snapshot and resumes the agent through the existing ladder. 3. GET and POST /api/tasks/:id/unarchive: 404 unknown, 409 not archived, WorktreeError as 409 with its kind; route tests including the expired-snapshot case. 4. Frontend: Unarchive on archived sidebar rows and in the command palette, with a confirmation built from the preview; on success the task opens. The archive confirmation says it can be unarchived and until which date. 5. Tests and wiki.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented by a delegated agent from the recorded plan. Its deviations: the preview reports a snapshot as expired only once the boot sweep has dropped the ref, not on the clock, so the dialog never says work is lost that the restore would then apply; the sweep now keeps wip_at so an expired snapshot is told apart from none; the palette lists one Unarchive row per archived task; a preview for an unknown repository or base ref fails as 409 rather than guessing. Code review (high, with fix) raised 10 findings; 6 fixed: a failed unarchive left the row in both lists (archived list refetched); a refused preview was hidden behind a generic line (the dialog quotes the server's reason); an unarchive kept its pre-archive rank (stamped on the flip); a stale resolveCommit comment; the preview-on-open effect duplicated across both dialogs (use-preview-on-open); wiki. I also reworded the archive dialog's last line, which put the date on unarchiving itself, to say the task can be unarchived at any time and its uncommitted work comes back until the date. Left: a boot-time race between the expiry sweep and an unarchive starting mid-drop; rows expired before this change read as no snapshot; the unarchive spawns at the stored size, not the pane's. Also fixed here, from TASK-138.1: the shared capture threw away what a helper printed before its timeout kill, which made PTY cwd lookups read as unknown under load; it now waits 250ms for a killed helper to exit, and only the PTY lookups keep killed output (a cut-off ps table is still refused).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Archived tasks can be unarchived from their sidebar row or the command palette. A confirmation built from a preview says what comes back: the checkout on its branch, recreated at the snapshot's commit, from origin or from the base ref when the archive deleted it, and the uncommitted work while the snapshot is kept. Confirming flips the row back to suspended with its checkout evicted and resumes it through the existing restore, then opens the task. The archive confirmation now says the task can be unarchived at any time and until when its uncommitted work comes back. Review: 6 of 10 findings fixed, plus the dialog wording, see notes. Verified on an isolated server in Chrome with a worktree task holding an uncommitted file: archive removed the checkout and deleted its merged branch, the unarchive dialog described recreating the branch from the snapshot, confirming brought the checkout back on its branch with the file intact, the task went live and opened, and the archive dialog showed the retention date. Typecheck clean; vitest 593 pass; bun test 2162 pass with two load timeouts (manager broadcasting, pty getCwd) that pass alone.
<!-- SECTION:FINAL_SUMMARY:END -->
