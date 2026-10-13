---
id: TASK-132
title: Show in Finder brings Finder to the front
status: Done
assignee: []
created_date: '2026-10-13 08:19'
updated_date: '2026-10-13 08:36'
labels:
  - files
  - api
dependencies: []
ordinal: 134000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
With the browser in front, Show in Finder selects the file but the Finder window opens behind the browser: open -R leaves activation to Finder, and macOS does not let it take the foreground from the app in use. The route should bring Finder forward after a successful reveal.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 After a reveal from a browser that is frontmost, Finder is the frontmost app with the revealed item selected
- [x] #2 A failed reveal does not activate Finder
- [x] #3 The commands the route runs are covered by a unit test; the wiki page says what runs and why
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reproduce: with Chrome frontmost, a bare open -R leaves Chrome in front. 2. revealCommands returns the reveal followed by open -b com.apple.finder; the route runs them in order and stops at the first failure. 3. Unit test the command list; verify on an isolated server with a script that samples the frontmost app. 4. Wiki page and log.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Reproduced with a script sampling lsappinfo front: Chrome frontmost, bare open -R, Chrome still frontmost 400 ms and 1 s later. open uses NSWorkspace selectFile:inFileViewerRootedAtPath:, which leaves activation to Finder. revealCommands now returns the reveal followed by open -b com.apple.finder; runRevealCommands runs them in order and stops at the first failure. A failure of the second command answers 500/504 like the first: the window stayed behind the browser, so an error toast is right.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The reveal route brings Finder to the front after selecting the path. Review (/code-review --fix): 5 findings, 1 fixed: the spawn loop moved into an exported runRevealCommands with four tests (order and 204, stop on failure with 500, stop on timeout with 504, unstartable command is a 500). Left: activation failure reported as a reveal failure (intended), a possible extra Finder window if Finder has none open and answers the reopen before the reveal window exists (speculative, untested), the worst-case wait doubling to 20 s, and a single-command alternative that would open directories instead of selecting them. Verification on an isolated server (port 4599): with Chrome frontmost, POST /reveal answered 204 and Finder was frontmost 400 ms later with the path selected (a file, then a directory, the second after the review fix); a bare open -R as control left Chrome in front; a missing file answered 404 and left Chrome in front. Checks: typecheck clean; 540 rendering tests pass; unit suite passes except watcher.test.ts, which fails intermittently under this machine's load (average 40 to 55) and touches nothing changed here; the review's own run had 2043 pass, 0 fail.
<!-- SECTION:FINAL_SUMMARY:END -->
