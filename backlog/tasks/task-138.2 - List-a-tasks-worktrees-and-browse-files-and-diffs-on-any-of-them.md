---
id: TASK-138.2
title: List a task's worktrees and browse files and diffs on any of them
status: Done
assignee:
  - '@claude'
created_date: '2026-11-05T07:00:00Z'
updated_date: '2026-11-05T09:02:00Z'
labels:
  - frontend
  - backend
dependencies: []
parent_task_id: TASK-138
ordinal: 142000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Subagents often work in their own git worktrees of the task's repository. Their changes are invisible in CodeToaster, because the Explorer's Changes, Files and History sections and every file and diff tab are rooted at the task's own checkout, so viewing a file or a diff on one of those worktrees means leaving for another tool.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A task shows the worktrees of its repository with each one's path and branch, the task's own checkout marked
- [x] #2 Choosing a worktree points the Explorer's Changes, Files and History at that worktree, and switching back returns to the task's checkout
- [x] #3 File and diff tabs opened from a worktree show that worktree's contents and say which worktree they belong to
- [x] #4 A worktree removed from disk drops out of the list, and a tab rooted at it reports that it is gone rather than erroring
- [x] #5 Paths outside the repository's worktrees are refused by the serving routes, with route-level tests covering it
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Server: rootRoutes gains a third scope, /api/worktrees/:id/<subpath>, whose id is a base64url token of the base root (tasks or projects, and its id) plus an absolute worktree path. resolveRoot resolves the base root, lists its repository's worktrees (git worktree list --porcelain, cached briefly), and answers the worktree as the root only when the realpath matches one; otherwise 404 Worktree not found. 2. GET <root>/worktrees (via rootRoutes, so tasks and projects): path, branch or detached sha, and current for the base root's own checkout. 3. Client: RepoRoot gains kind worktree with its base and path; rootApi and rootId handle it, so every existing hook works unchanged. File, diff and diffAll tab descriptors gain an optional worktree path that is part of the tab key, and the panes read the worktree root when it is set and name the worktree. 4. Explorer: a worktree picker above the sections when the repository has more than one worktree, choice kept per task in the view-state store; Changes, Files, History, Refs and Backlog read the chosen root; a chosen worktree that disappears falls back to the task's checkout, and a tab on a removed worktree says it is gone. 5. Tests: route-level for the worktrees listing and the scope (happy path, unknown base 404, path outside the repository refused, removed worktree), unit for the token and porcelain parsing, rendering for the picker and a worktree tab.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented by a delegated agent from the recorded plan; deviations it reported: the worktree root id encodes the base id so the view-state sweep can find it; the picker lives in the Explorer and the shell reads the same store for the rail and Review all; the worktree list is polled every 15s since nothing watches worktrees; a gone worktree is detected by the frame's list check, so a pane's raw 404 can show for one round trip; commit tabs from a worktree's History read through the task root, since worktrees share one object store. Code review (high, with fix) raised 9 findings; 4 fixed: a review submitted from a worktree diff now opens with a line naming the worktree its paths are relative to (unit tested); the section no longer remounts when the worktree count crosses one; a project's worktree root follows the project's Changes rule; a redundant local. Left: the symbol index map is never evicted, so each browsed worktree's index stays in daemon memory (project paths have the same gap, wants its own task); the worktree list polls even with the Explorer closed; realpath runs on every worktree per request; a worktree key naming the task's own checkout makes a second tab; the picker shows no selection if the server cannot realpath the root.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
When a task's repository has more than one worktree, a picker above the Explorer's sections points Changes, Files, History, Refs and Backlog at the chosen worktree (Processes stays on the task), kept per task. File and diff tabs opened from it read that worktree, carry it in their tab key, and name it in the tab and the pane; a tab on a removed worktree says it no longer exists. Server: every repository route is also served under a worktree scope whose id names the base root and a worktree path, resolved only when the path is one of the repository's live worktrees; a worktrees listing route marks the task's own checkout. Review: 4 of 9 findings fixed, see notes. Verified on an isolated server in Chrome with a fixture repository and a second worktree: the picker listed both, choosing the side worktree showed its files and a README tab reading its content, switching back restored the task's files, crafted ids for the root directory, another repository and a dotdot path were refused with 404 and a malformed id with 400, and removing the worktree turned its open tab into the no-longer-exists note and dropped the picker. Typecheck clean; bun test 2135 pass, 0 fail; vitest 583 pass.
<!-- SECTION:FINAL_SUMMARY:END -->
