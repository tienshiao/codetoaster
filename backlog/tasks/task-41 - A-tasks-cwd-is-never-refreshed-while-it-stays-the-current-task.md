---
id: TASK-41
title: A task's cwd is never refreshed while it stays the current task
status: Done
assignee:
  - '@claude'
created_date: '2026-08-29 06:14'
updated_date: '2026-08-29 08:28'
labels:
  - server
  - frontend
milestone: m-5
dependencies:
  - TASK-40
documentation:
  - docs/v2-architecture.md
priority: medium
ordinal: 41000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TaskManager.attachClient calls refreshCwd, and the comment there claims opening a task's terminal 'is the only such moment the browser reaches'. It is not: attachSession (frontend/SessionContext.tsx) early-returns when the id already matches currentSessionIdRef, so moving between the Terminal, Changes, Files, History and git tabs of the *current* task never re-attaches and never refreshes anything.

Concretely: the agent cd's from repo A into repo B — a worktree, a submodule, a sibling checkout — the user clicks Changes, and the diff, file tree, git log and symbol routes keep answering out of repo A for as long as that task stays selected. Only switching to a different task and back fixes it. A single-task user never hits the refresh at all.

This is the cost side of §5.4's trade: the routes read the row instead of asking a process on every request, which is right, but then something has to notice when the row goes stale. The fix needs a trigger that is not 'a git call per data request' — an explicit refresh route the tab hosts can call, or a socket message on tab activation — and it should land alongside TASK-40, since today's refreshCwd blocks the event loop on ps + lsof and making it fire more often would make that worse rather than better.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Switching between the tabs of the current task picks up a cwd the agent has moved to, without a full re-attach
- [x] #2 The refresh does not add a git call or a process spawn to every data request — §5.4's trade stays intact
- [x] #3 A task whose agent cd'd into a different repository answers diff, files, git and symbols out of the new repo_root
- [x] #4 Tests cover a cwd change observed without switching tasks
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. The refresh belongs in resolveTaskRoot, the one helper every data route already goes through, rather than in the frontend. A tab host that has to remember to ask is a tab host someone will add without asking; putting it where the root is resolved means a route added later inherits it.
2. It is throttled per task, so "not a git call per request" holds without the frontend coordinating anything: the first request after the window pays one lookup, and the diff view's follow-up requests do not. TASK-40 is what makes this affordable — before it, this would have added a blocking ps+lsof to a data route.
3. resolveTaskRoot becomes async. Every call site is already inside an async handler, so it is an await and nothing more.
4. GET /api/tasks and attachClient move to the throttled variant too. Listing thirty tasks currently asks thirty times on every poll.
5. The throttle map is cleared with the task in closeTask, so a closed task leaves nothing behind.
6. Tests: a live task whose shell cd's is picked up by a data route with no re-attach and no task switch; a second call inside the window does not look again; a suspended task with no PTY still answers from its row without paying anything.
7. Then /code-review --fix and /verify.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
The refresh went into resolveTaskRoot, the one helper every data route already calls, rather than into the tab hosts. A tab host that has to remember to ask is one somebody will add without asking; putting it where the root is resolved means a route added later inherits it. Throttled per task (3s, settable) so "no git call per request" still holds: the first request after the window pays a lookup and the diff view's follow-ups do not.

Only affordable because of TASK-40. Before that, this would have put a blocking ps+lsof in front of every diff request — which is why TASK-41 was filed as depending on it.

Code review then found the throttle recorded its timestamp before checking the task existed, so an unknown id grew a permanent map entry per request, and that runCapture had no timeout — which mattered much more once getCwd sat in front of every data route, since a wedged mount became a request that never answered. Both fixed (2s kill, mirroring gitSpawn).

Runtime verification, with the cd sequenced so it can only be attributed to the data route: attach, wait for the attach's own refresh to land and the window to lapse, cd, detach, and then make no further attachments. The row still read /Users/tma/Projects/codetoaster; one GET /files later it read .../src. Cost measured on the same task: 132ms for the first request, then 25ms, 32ms, 25ms, 25ms, and 171ms again once the window lapsed — bounded, and paid once per window rather than per request.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A task's data routes now notice when its agent has moved. resolveTaskRoot asks the live terminal where it is, at most once every few seconds per task, so a user working inside one task's Changes, Files and History tabs no longer browses the repository it started in — the case attach could never cover, because a client only re-attaches when it changes task. Verified by cd-ing a live task's shell with nothing re-attaching afterwards: the row stayed stale until a single data request, which followed it, at 132ms for that request and 25ms for the ones behind it.
<!-- SECTION:FINAL_SUMMARY:END -->
