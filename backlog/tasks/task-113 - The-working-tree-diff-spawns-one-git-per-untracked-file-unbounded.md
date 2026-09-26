---
id: TASK-113
title: 'The working-tree diff spawns one git per untracked file, unbounded'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-26 02:46'
updated_date: '2026-09-26 03:34'
labels:
  - bug
  - server
dependencies: []
priority: high
ordinal: 115000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
GET /api/tasks/:id/diff builds the untracked half of the diff with Promise.all over listGitFiles(dir, {cached:false}), one git diff --no-index /dev/null <file> per untracked file, with no concurrency cap. A checkout with thousands of untracked files (MyBrowser has ~3700 under an unignored Xcode .dd-main/ build folder) therefore forks thousands of git processes on every request. Since TASK-103 the request is not rare: useExplorerRail keeps the diff query active for the selected task (for the Changes count), and every watcher batch during a build invalidates taskKeys.diff up to once a second, so a build in that checkout makes the daemon fork-bomb git for its whole duration. Observed on the production daemon on 2026-09-25.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The untracked-file diff is produced by a bounded number of git processes regardless of how many untracked files there are (a single git diff --no-index over the list, git add -N against a throwaway GIT_INDEX_FILE, or a small worker pool with a cap)
- [x] #2 Concurrent diff requests for the same task coalesce into one in-flight computation rather than each spawning their own
- [x] #3 The diff for a normal checkout is byte-identical to today's output
- [x] #4 A checkout with 2000 untracked files is diffed by a constant four git processes (index path, unmerged list, intent-to-add over a copy of the real index, filtered diff), counted by a test through a logging git shim; an add that dies because a file vanished mid-walk is retried with backoff, covered by a shim that dies on cue; the per-file pool is reached only when every attempt fails or a file cannot be read
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. utils.ts: replace diffUntrackedFile with diffUntrackedFiles(dir, files): drop nested-repo entries (trailing slash), then git add -N --pathspec-from-file=- against a throwaway GIT_INDEX_FILE in a mkdtemp dir with GIT_LITERAL_PATHSPECS=1, then one git diff against that index. On a non-zero add (a file vanished between ls-files and add) fall back to the old per-file diff --no-index through a pool of 8. 2. utils.ts: add coalesce(key, fn) so concurrent callers share one in-flight promise. 3. diff.ts: move the two Bun.$ diffs to gitSpawn, call diffUntrackedFiles, wrap the computation in coalesce keyed by task id. 4. utils.test.ts: byte-for-byte comparison against per-file no-index output over text, binary, empty, no-eol, spaces, pathspec-magic and symlink files with a modified and a staged tracked file present; a child bun process with a logging git shim shows 2 spawns for 2000 files; a vanished file takes the fallback and still returns the others; coalesce unit test.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause: MyBrowser's checkout had ~3700 untracked files under an unignored .dd-main/ Xcode build folder; useExplorerRail keeps the diff query active for the selected task and every watcher batch during a build invalidated it, so the route forked ~3700 gits a second while Xcode built. The one-shot intent-to-add diff was checked against the per-file output in a scratch repo before being written: byte-identical per file, and the same order since both the scratch index and ls-files sort by path. A nested repository (listed as dir/) makes add -N abort, so it is dropped first as the old code effectively did. Validation: bun test src/api/diff.test.ts (12 pass), bun run test:unit (1692 pass), tsc clean.

Code review (high) found seven real problems, all fixed: a late coalesce caller was handed a diff computed before the write it reacted to (now every mid-run caller is promised one rerun after the current run settles); the per-file fallback re-created the spawn storm whenever a file vanished between ls-files and add -N during a build (now the add is retried once against a fresh listing, and the pool is reached only for a file git cannot read); a file vanishing between the add and the diff printed as a deletion (dropped, since only an intent-to-add entry can produce one there); core.splitIndex=true leaked a sharedindex file per request (-c core.splitIndex=false); the fallback lacked -- so a dash-named file was read as an option (the one deliberate output difference from before: such files now appear); the coalesce key ignored the directory (now id plus dir); the route's 500 dropped git's stderr. Skipped: reusing a fixed per-task scratch index path instead of mkdtemp, two syscalls per request is not worth threading the task id through.

Runtime verification (verify skill, isolated server on 4599 with a logging git shim, scratch repo with 3000 untracked files): the explicit-listing one-shot lost the listing-to-add race once in ten requests under file churn and fell to the per-file pool for 11s. Redesigned: the scratch index is a copy of the real one, git add -N . discovers the untracked files itself, and git diff --no-renames --diff-filter=A yields exactly the new-file sections. Gitlink sections (nested repos with commits) are dropped; unmerged paths are settled to stage 0 in the copy first because git add . collapses their stages whatever pathspec is given; --no-renames stops an empty untracked file pairing with a deleted empty tracked one. A file vanishing between git's readdir and its lstat is still a fatal the add cannot step over, so the add is retried up to five times with growing backoff. Final runtime numbers: one request is 6 git processes and 0.67s for 3001 untracked files, byte-identical to the old per-file output; five concurrent requests are two computations and one hash; under sustained churn deleting a file every ~2ms for seconds, one request per burst still exhausts the retries and takes the bounded pool (16 wide, ~10s), which the coalescer keeps to one at a time. No sharedindex files or scratch dirs are left behind.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The working-tree diff route no longer spawns one git per untracked file. diffUntrackedFiles copies the real index to a throwaway GIT_INDEX_FILE, lets git add -N . record every untracked path as intent-to-add, and takes one git diff --no-renames --diff-filter=A over it, byte-identical to the old per-file output; gitlink sections are dropped, unmerged paths are settled in the copy first, an add that dies on a file vanishing mid-walk is retried with backoff, and only then does a per-file pool of 16 take over. The route coalesces concurrent requests per task and directory with a guaranteed rerun for callers who arrive mid-run, and both plain diffs moved from Bun.$ to gitSpawn. Verified by src/api/diff.test.ts (20 tests, including a shim-counted four spawns for 2000 files, a shim that kills the add twice, and a route test over a real server), the full unit suite (1702), tsc, a high-effort code review whose findings were fixed, and the verify skill against an isolated server with a 3000-file scratch repo under churn.
<!-- SECTION:FINAL_SUMMARY:END -->
