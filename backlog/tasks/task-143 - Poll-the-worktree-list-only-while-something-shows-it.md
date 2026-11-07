---
id: TASK-143
title: Poll the worktree list only while something shows it
status: Done
assignee:
  - '@claude'
created_date: '2026-11-05T09:20:00Z'
updated_date: '2026-11-07T02:21:00Z'
labels:
  - frontend
dependencies: []
ordinal: 147000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The worktree list added by TASK-138.2 is polled every 15s by a hook the task shell always mounts, so every open window on a task or a composer project makes the daemon list the repository's worktrees every 15 seconds (after a 3s server cache), even with the Explorer closed and only one worktree to show. The poll exists because nothing watches worktrees, but it only needs to run while the picker, the rail or an open worktree tab can show its answer. Raised by the TASK-138.2 code review.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 With the Explorer closed and no worktree tab open, no worktrees request is made after the first
- [x] #2 With the Explorer open, or a worktree tab open, the list still refreshes and a removed worktree still drops out
- [x] #3 Returning focus to the window refreshes the list once
- [x] #4 A rendering test covers the closed panel making no requests and reopening it resuming them
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Three observers read the list: TaskShell (always mounted, for the rail and Review all), the Explorer (mounted only while open) and WorktreeFrame (a worktree tab). Only TaskShell polls for nothing. 2. useRootWorktrees and useExplorerWorktree take a poll option (default on); off means no interval and no focus refetch. 3. TaskShell passes poll off; its hook still polls while a worktree choice is stored, because the rail and Review all then read that worktree and a removal has to clear the choice. 4. The Explorer and a worktree tab keep polling as now, so opening the panel resumes it (a stale list refetches on mount) and focus refetches once through React Query, which refetches a query once per focus whatever its observer count. 5. Render test: a TaskShell-shaped harness (shell hook with poll off, Explorer mounted only when open) under fake timers: closed makes one request and no more across several intervals, opening resumes, focus refetches once, a stored choice polls while closed.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The worktree list is polled only by readers that show it. useRootWorktrees and useExplorerWorktree take poll (default on); off means no interval, no focus refetch and no reconnect refetch. TaskShell, mounted whatever is on screen, passes poll off, and its hook still polls while a worktree is chosen because the rail and Review all then read that worktree and a removal must clear the choice. The Explorer (unmounted when closed, desktop and mobile) and WorktreeFrame keep polling, so opening the panel refetches a stale list and resumes the interval. Tests: Explorer-worktrees.render.tsx gains a TaskShell-shaped harness under fake timers - closed asks once across intervals, focus and reconnect; opening resumes, a focus asks once (also with two focus-refetching readers), closing stops; a chosen worktree polls while closed until its removal clears the choice. They fail with the old always-on interval. Code review (--fix): 5 findings, 2 fixed (reconnect refetch, a focus test that did not test dedup); skipped as pre-existing or tradeoffs: shell and Explorer each run an interval while a worktree is chosen and the panel is open (one poller per window would fix it), the Explorer polls on the Processes section, and the poll:false name hides the chosen exception. Verify: isolated server in Chrome - Explorer open, 2 requests per 35 s; closed, 0 in 45 s; reopened, an immediate request then one 15 s later. typecheck clean; render 599/599; unit 2185 pass, 1 fail in manager.test (shell exit within 4 s) under load average 14-20, passing alone and with the CLI and symbol tests.
<!-- SECTION:FINAL_SUMMARY:END -->
