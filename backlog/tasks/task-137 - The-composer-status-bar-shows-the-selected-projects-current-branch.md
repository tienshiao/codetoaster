---
id: TASK-137
title: The composer status bar shows the selected project's current branch
status: Done
assignee:
  - '@claude'
created_date: '2026-11-05T06:59:00Z'
updated_date: '2026-11-05T08:18:00Z'
labels:
  - frontend
dependencies: []
ordinal: 139000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On the new task screen (the composer) the status bar is empty because no task is selected yet, yet the branch the chosen project is on is what a new task will start from or branch off. Showing it there lets you catch being on the wrong branch before you start the task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 With a project chosen in the composer, the status bar shows that project's current branch
- [x] #2 Changing the chosen project updates the branch shown
- [x] #3 A detached HEAD shows the short SHA, and a project that is not a git repository shows no branch item
- [x] #4 The branch stays current if it changes on disk while the composer is open
- [x] #5 A rendering test covers the branch item, the project switch and the no-repo case
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. useRootBranch(root) hook: the branch from the refs query the Explorer already reads for the project root, a short SHA when detached, null for a non-repository (the route answers 400) or no root; branchLabel pure helper. 2. useGitRefs takes an optional per-observer refetchInterval; the composer polls every 10s because nothing watches a project directory unless a no-worktree task runs in it, and focus refetch misses a terminal beside the browser. 3. TaskShell: at the composer the status bar shows the branch in place of no task. 4. Rendering test of the hook: branch, project switch, detached, non-repository, null root. 5. Verify in the browser with a repository project and a plain-directory project.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Code review (high, with fix) raised 6 findings; 4 fixed: comments claimed the bar shows what the new task branches off, but a worktree task branches off the base ref when one is named, so they now say it is the checkout's branch (behaviour kept, per AC 1); the poll kept asking a non-repository every 10s (composerRefsPoll stops for a root that has only ever errored); the shell tests stubbed the hook away, so the bar wiring was untested (the composer shell test now renders status items and covers the branch, a project switch and no branch); the stale-data error branch had no test. Left: any failed refetch hides the branch until the next answer, since the hook cannot tell a removed repository from a blip without the status; and a detached HEAD shows a short SHA here while a task bar omits it, which AC 3 asks for.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
At the composer the status bar now shows the chosen project's branch in place of no task: useRootBranch reads it off the refs query the Explorer already uses for the project root, a short SHA when HEAD is detached, nothing for a directory that is not a repository. It polls every 10s while the composer is up, because nothing watches a project directory unless a no-worktree task runs in it, and stops polling a root that has only ever errored. Review: 4 of 6 findings fixed, see notes. Verified on an isolated server in Chrome: a project on this worktree showed its branch, detaching HEAD on disk switched the bar to the short SHA within the poll without a focus change, and switching to a plain-directory project showed no task. bun run typecheck clean; bun test 2087 pass and vitest 565 pass on the review's run. Note: for a worktree project with a default base ref, the bar names the checkout's branch, not the base the task will branch off; showing the base ref there would be a separate change.
<!-- SECTION:FINAL_SUMMARY:END -->
