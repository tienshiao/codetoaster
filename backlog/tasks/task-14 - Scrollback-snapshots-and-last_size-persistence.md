---
id: TASK-14
title: Scrollback snapshots and last_size persistence
status: Done
assignee: []
created_date: '2026-08-29 00:02'
updated_date: '2026-08-29 09:05'
labels:
  - server
  - tasks
milestone: m-2
dependencies:
  - TASK-5
documentation:
  - docs/v2-architecture.md
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Serialize a task's agent terminal to ~/.codetoaster/tasks/<id>/scrollback.ans and persist last_size_cols/rows on the row (§5.1, §5.5). Not in SQLite — these are multi-hundred-KB ANSI blobs. Used by every harvest path and by two-phase restore.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 snapshot(taskId) writes scrollback.ans next to settings.json and updates last_size on the row
- [x] #2 Snapshot files are removed when a task is archived
- [x] #3 A respawned task uses last_size as its initial grid (zero-attachments-keeps-size rule)
- [x] #4 Tests cover write, overwrite, and cleanup
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Pty.serialize(): string — expose the SerializeAddon output addClient already builds privately; addClient calls it instead of duplicating. Guard with a `disposed` flag set in kill(), so a serialize after dispose answers "" instead of throwing (harvest is snapshot-then-kill; a background tick must not die on the ordering).
2. taskScrollbackPath(taskId) in lib/agent/spawn.ts beside taskSettingsPath; lib/tasks/snapshot.ts with writeSnapshot / readSnapshot / removeSnapshot — pure filesystem, no manager coupling, so TASK-17 can read a snapshot with no live PTY.
3. TaskManager.snapshot(taskId): Promise<boolean> — serialize the primary PTY, write scrollback.ans, persist pty.getSize() to last_size_cols/rows. Returns false (never throws) on missing task, missing PTY, or write failure, so TASK-15's tick survives one bad task. Snapshots an exited-but-undisposed PTY (its buffer holds the agent's final output). With no PTY at all it leaves any existing snapshot alone: stale beats none.
4. removeSnapshot wired into closeTask, which is today's destructive end-of-task path (it deletes the row; the id can never be reissued). TASK-16 moves it to archive when close becomes suspend. Update the comment at manager.ts:777, which costed that decision at 'a few KB of JSON' before scrollback blobs existed.
5. Read side (AC #3) is already at manager.ts:534 — the resume ladder prefers row.last_size over DEFAULT_SIZE, and Pty.recalculateSize() early-returns at zero clients so a detached PTY keeps its grid. New coverage is the round trip: snapshot() -> row -> respawn grid.
6. Tests: snapshot.test.ts (write, overwrite, read-missing, remove) following settings.test.ts's convention of a unique task id under the real taskDir with rmSync cleanup; manager tests for last_size persistence, the close-removes-snapshot path, and no-PTY leaving an existing snapshot intact.

Deliberately uncapped: addClient serializes the full 10k-line buffer on every restore, so capping the snapshot would make the file disagree with a live attach.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Landed as designed; the plan matches the final code.

Two hazards surfaced in review and were fixed in TASK-14's own code:
- snapshot() would have persisted serialize()'s disposed-terminal "" over a good snapshot — the opposite of the no-PTY branch's 'stale beats none'. Now gated on a new Pty.isDisposed.
- Its write could land after closeTask's fire-and-forget removal, orphaning a multi-hundred-KB file under an id that can never be reissued. Now re-checks the row after the await and removes what it just wrote.
- readSnapshot's exists()/text() pair is a TOCTOU against that same unawaited removal; text() now falls back to undefined rather than rejecting, which is what its contract already promised.

Known, deliberately not fixed: snapshot() writes the file before updating last_size on the row, so a crash in the microtask gap between them leaves a snapshot whose grid the row does not record, and TASK-17 would repaint it at DEFAULT_SIZE and reflow. The window is far narrower than the resume ladder's equivalent (no I/O between the two), and the honest fix is to carry the grid inside the snapshot file so the two cannot disagree — a format decision that belongs to TASK-17, which has not consumed the format yet. Noted on TASK-17.

Validation: bun test 416 pass / 0 fail; bunx tsc --noEmit clean. Runtime drive against a real PTY on an isolated db: snapshot() wrote 312 bytes of real ANSI containing the painted marker, persisted last_size 120x30, overwrote rather than appended on a second call, kept the grid with zero attachments, and closeTask removed the file while leaving settings.json (the documented split). snapshot() on a closed task returns false.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the scrollback snapshot mechanism the harvester and two-phase restore are built on: Pty.serialize()/isDisposed, taskScrollbackPath(), a manager-free lib/tasks/snapshot.ts (write/read/remove), and TaskManager.snapshot() which writes ~/.codetoaster/tasks/<id>/scrollback.ans and persists last_size on the row. It never throws, so TASK-15's tick survives a bad task; it leaves an existing snapshot alone when there is no PTY, since stale beats none. closeTask removes the blob — today's destructive path — moving to archive when TASK-16 turns close into a suspend. Verified with bun test (416/0), tsc --noEmit, and a runtime drive against a real PTY covering all four ACs.
<!-- SECTION:FINAL_SUMMARY:END -->
