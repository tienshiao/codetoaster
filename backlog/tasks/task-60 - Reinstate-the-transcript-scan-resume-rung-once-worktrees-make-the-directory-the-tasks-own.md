---
id: TASK-60
title: >-
  Reinstate the transcript-scan resume rung once worktrees make the directory
  the task's own
status: Done
assignee:
  - '@claude'
created_date: '2026-08-31 01:37'
updated_date: '2026-08-31 20:28'
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
- [x] #1 The scan rung is on the ladder again for a task whose cwd is a worktree codetoaster created, and stays off for one running in a shared directory
- [x] #2 The gate is worktree provenance, not the mtime window alone; a task in a plain cwd is unchanged by this task
- [x] #3 A test covers a degraded task in a worktree recovering a conversation under an id that was never reported
- [x] #4 A test covers the same shape in a non-worktree cwd still refusing to guess
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add `runsInOwnWorktree` to src/lib/agent/transcripts.ts: the gate is provenance (worktree_state=present, path under worktreesRoot(), basename === task id, cwd inside it), not the mtime window and not path shape.
2. Widen `findResumableTranscript`'s exclusion from `notThis` to `notThese`, so the scan can skip every id the ladder can name (the stored id and the reported one) rather than only the one just tried.
3. Reinstate the rung in `TaskManager.resumeLadder`, gated on `runsInOwnWorktree`, resuming the found conversation by id.
4. Leave `continueIsSafe` gated exactly as TASK-43 left it: in a worktree the scan already reaches the same conversation and names it, so loosening --continue would only add a vaguer path to it.
5. Tests: unit tests for the gate in transcripts.test.ts; a paired ladder test in resume.test.ts (same degraded task, worktree vs plain cwd, opposite outcomes) plus one pinning where the scan reaches.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
The gate is `runsInOwnWorktree` (src/lib/agent/transcripts.ts). Three conditions, each answering a different way of being wrong: `worktree_state === "present"` (an evicted or missing row names a directory whose contents we no longer account for), the path sitting under `worktreesRoot()` (says we created it rather than found it), and its basename being the task's id (says it was created for *this* task — the one claim that survives a task being reassigned when its project is deleted, TASK-64, which leaves the checkout where it was). The cwd is required to be *inside* the checkout rather than equal to it, so TASK-65 putting the agent in a subdirectory does not silently turn the gate off.

`findResumableTranscript`'s `notThis` became `notThese`. The ladder can name two ids by the time the scan runs — the stored one and the one the task reported — and the exclusion has to cover both. The one that matters is the `--continue` rung: it opens the newest file in the directory, which is exactly what an unfiltered scan would hand back next.

`continueIsSafe` was deliberately left gated as TASK-43 left it, and the reason is recorded next to it. In a worktree the scan reaches the same conversation one rung later and resumes it *by id*, so it says which conversation it opened; loosening `--continue` would only add a vaguer way to reach it first.

A test expectation was wrong before the code was: the scan legitimately reaches *past* the conversation `--continue` already tried, to the task's own older one. In a shared directory that was a stranger's conversation and the reason the rung came off; in a checkout nothing else runs in it is what §4.3's 'transcript pruned, version skew' case falls back on. `resume.test.ts` now pins both halves — never back to what was tried, but past it when the newest will not open.

Validation: `bunx tsc --noEmit` clean; `bun run test` green (892 unit across 55 files, 100 render across 14).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Reinstated §4.3's scan rung on the resume ladder, gated on the task running in a checkout codetoaster made for it.

New `runsInOwnWorktree` in src/lib/agent/transcripts.ts answers that gate from provenance — `worktree_state = present`, a path under `worktreesRoot()` whose last segment is the task's id, and a cwd inside it — never from the mtime window, which TASK-43 showed cannot tell this task's conversation from a stranger's in a shared directory. `findResumableTranscript`'s exclusion widened from `notThis` to `notThese` so the scan skips every id the ladder can already name, most of all the one `--continue` just opened. `resumeLadder` calls it and resumes what it finds by id. `continueIsSafe` is unchanged: in a worktree the scan reaches the same conversation one rung later and says which one it opened.

The rung recovers what TASK-43 had to give up — a degraded task whose `/clear` left its real conversation under an id nothing reported — and, as the tests found, also reaches past a newest conversation that will not open to the task's own older one, which is §4.3's 'transcript pruned, version skew' case.

Verified with `bunx tsc --noEmit` (clean) and `bun run test` (892 unit, 100 render, all passing). New tests: seven for the gate in transcripts.test.ts, and three ladder tests in resume.test.ts — a matched pair running the same degraded task in a worktree and in a plain cwd to opposite outcomes, plus one pinning where the scan reaches.
<!-- SECTION:FINAL_SUMMARY:END -->
