---
id: TASK-128
title: 'Commit tab Changes view: choose what the diff is relative to'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-03 20:09'
updated_date: '2026-10-03 20:43'
labels: []
dependencies: []
ordinal: 130000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Reviewing a worktree branch means seeing everything it changed since it left its parent branch, not just its tip commit. Clicking a branch opens its tip commit; the commit tab's Changes view gains a selector that picks a ref for the diff to be relative to, so the view shows the branch's whole change set against that ref.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The Changes view shows a 'Relative to' selector on the same row as the Commit | Changes | File Tree switch, to its right, and in no other mode
- [x] #2 The selector lists Parent commit (the default, today's behaviour) followed by local branches, remote branches and tags, and typing filters the list
- [x] #3 Choosing a ref shows the diff from the merge base of that ref and the commit to the commit, with syntax tokens and image previews reading the old side from the merge base
- [x] #4 The choice is kept per commit tab across tab switches and reloads, and follows the ref when it moves
- [x] #5 A chosen ref that no longer exists falls back to Parent commit; a commit with nothing changed relative to the ref says so
- [x] #6 Commit mode and File Tree are unchanged
- [x] #7 Server and rendering tests cover the base diff and the selector
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Server: /git/commit takes an optional base sha; with it the diff is merge-base(base, sha)..sha, and the response names the commit the old side was read from (diffBase). 2. Server: /diff-tokens takes an optional base for the old side instead of the first parent. 3. Client: useGitCommit takes a base sha (in the query key), passes diffBase to the token fetch. 4. Client: CommitViewState.changesBase holds the chosen ref as kind:name, persisted; CommitDetail resolves it against /git/refs so the diff follows the ref, and falls back to the parent when the ref is gone. 5. Client: a filterable v2 Select labelled Relative to in the mode bar, Changes mode only; empty state when nothing differs. 6. Tests: git route test over a scratch repo, CommitDetail rendering test. 7. Wiki page and log.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Server: /git/commit takes base (a sha) and diffs merge-base(base, sha)..sha, falling back to a direct diff for unrelated histories; the response's diffBase names the old side. /diff-tokens takes base for the old side. Client: the choice is CommitViewState.changesBase, stored as kind:name and resolved against /git/refs each render (utils/diff-base.ts); the selector is the v2 Select with its filter. Verified in Chrome on an isolated server: split-view relative to main shows 27 files +2189 -452, matching the three-dot diff from the CLI; the choice survives a reload; a base containing the commit shows the empty state.

Code review (v2, high) found ten issues; six fixed in 7909e90: a merge-base failure other than exit 1 is a 500 instead of a direct diff; a failed diff is a 500 instead of an empty one; the route uses diff-tree so user diff config and external drivers do not apply; the diff runs under a 30s timeout; a stored choice whose ref is gone is dropped once the refs load; null tokens are refetched on the next mount; a filtering Select draws at most 200 rows. Left as is: collapsed files are one set shared by every base and are pruned on a switch; a moving base ref refetches the diff even when the merge base is the same; a tag that is not a commit is offered and answers 404; the diff output is still buffered whole before capDiff.

A second review of the branch found ten more; eight fixed in 35ebac7: the diff timeout is 8s (under the server's 10s idle timeout) and reading stops at 128 MB with a 413; /git/refs answers 500 when the listing fails and omits tags on a tree or blob; a moving base ref keeps the previous diff as placeholder data and the layout is keyed by the merge base; the commit query does not retry the server's own refusals; null tokens are retried after 60s rather than every mount; /diff-tokens takes oldSha and always gets diffBase; the selector's title no longer claims a fork point; the Select's row cap keeps the chosen row. Left: collapsed files are shared across bases; the 5s client timeout and 200-file cap on tokens are unchanged, so a very large branch diff may stay on the regex fallback. Validation: bun run test (1983 unit, 509 rendering) and tsc pass; the second round's fixes were checked by tests and a runtime check against an isolated server, not by a third review.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The commit tab's Changes view has a filterable Relative to selector beside the mode switch. Choosing a branch, remote or tag shows the diff from the merge base of that ref and the commit, so a worktree branch can be reviewed whole against the branch it was cut from. The choice is stored per commit tab by ref name and follows the ref. /git/commit takes base and reports diffBase; /diff-tokens takes oldSha. Verified in Chrome on an isolated server against the CLI's three-dot diff, with server and rendering tests.
<!-- SECTION:FINAL_SUMMARY:END -->
