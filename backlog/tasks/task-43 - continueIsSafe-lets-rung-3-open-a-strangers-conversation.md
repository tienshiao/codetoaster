---
id: TASK-43
title: continueIsSafe lets rung 3 open a stranger's conversation
status: Done
assignee: []
created_date: '2026-08-29 09:05'
updated_date: '2026-08-31 02:05'
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
- [x] #1 The no-transcript_path case can no longer reach --continue, or the ladder documents why it is safe to
- [x] #2 A test covers a task whose stored id has no transcript and a foreign conversation exists in the same directory
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
`continueIsSafe` now asks whether the newest transcript in the task's directory is one we can *name* as this task's, and answers no when it cannot. Two things can name one: the path the agent reported at its SessionStart, and — for a row that never reported one — the id we minted and passed to `--session-id`, which nothing else in the directory can be called because we generated it.

Two behaviours changed:
- A row with no `transcript_path` no longer answers `true` unconditionally. It is now safe only when the minted id is the newest conversation present. That is the reported bug: this guard is asked only after the ladder has declined or failed the minted id, so for such a row there is no conversation of ours in the directory and the newest one is by elimination a stranger's.
- Seeing no transcripts at all now answers `false` rather than `true`. An empty directory makes `--continue` merely useless, but `projectsDirFor` only guesses at the escaping rule, so we may be looking in the wrong place — and `--continue` opens what is really in the cwd, not what our guess found. Refusing costs a rung; allowing costs a stranger's conversation.

Kept the degraded-mode path working: a task whose hooks never arrived, so no SessionStart ever set `transcript_path`, still resumes on the strength of its minted id.

Consequence, and the part worth review: this made §4.3's last rung — the directory scan — unreachable-or-wrong, so `resumeLadder` now stops one rung short of it. If the guard passed, the newest transcript is ours and rungs 1-3 already offered it by id and by `--continue`, so the scan can only reach past it to something older that nothing has shown to be ours. If the guard failed, the scan has to be refused for the reason the guard was — declining `--continue` because the newest is a stranger's and then opening that very file by id one rung later would make the guard theatre. Either way it yields a conversation we never started or nothing at all. `findResumableTranscript` and its tests were kept; TASK-60 reinstates the rung on worktree provenance in m-4.

What that costs, stated plainly: a degraded task whose agent then ran `/clear` leaves its real conversation under an id we were never told, and that is now unrecoverable — indistinguishable from a stranger's in a shared directory, which an mtime window does not fix.

Validation: `bun run test` — 738 unit tests and 79 render tests pass, 0 fail. `bunx tsc --noEmit` reports nothing new in the touched files (the repo has pre-existing errors in AppShell/DiffLayout/GitView/commands.ts, untouched here).

Correction to the validation line above: there are no pre-existing type errors. `bunx tsc --noEmit -p tsconfig.json` exits 0 across the whole project. The errors attributed to AppShell/DiffLayout/GitView/commands.ts were transient language-server diagnostics, not compiler output — the modules and exports they named as missing all exist.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed `continueIsSafe` (src/lib/agent/transcripts.ts) so `--continue` and the transcript scan are offered only when the newest conversation in the task's directory is one we can name as the task's — its reported transcript path, or the session id we minted. A row with no transcript_path, and a directory we can see nothing in, both now answer unsafe rather than safe, closing the path by which rung 3 could open a stranger's conversation and bind the task to it at its next SessionStart. Degraded tasks (no hook ever set transcript_path) still resume via their minted id. The correction leaves §4.3's scan rung subsumed, so `resumeLadder` stops short of it with the reasoning written down and TASK-60 filed to reinstate it on worktree provenance. Verified with `bun run test` (738 + 79 pass, 0 fail), including a new ladder regression test for a task whose minted id has no transcript and a foreign conversation sits in the same directory.
<!-- SECTION:FINAL_SUMMARY:END -->
