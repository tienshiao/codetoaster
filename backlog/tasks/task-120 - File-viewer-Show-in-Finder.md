---
id: TASK-120
title: 'File viewer: Show in Finder'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-29 06:04'
updated_date: '2026-09-29 06:16'
labels:
  - frontend
  - api
dependencies: []
ordinal: 122000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A file tab's header gets a Show in Finder button that reveals the open file in Finder on the machine running the daemon (open -R). Useful when the browser and daemon share a Mac; hidden elsewhere, since revealing on a remote host helps no one.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A file tab header shows a Show in Finder button when the browser is on macOS
- [x] #2 Clicking it reveals and selects the file in Finder via POST /api/tasks/:id/reveal (and the projects equivalent)
- [x] #3 The route rejects a missing or escaping path (400), a missing file (404), and a non-macOS daemon (501)
- [x] #4 Tests cover the route's refusals without launching Finder
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. POST reveal route in api/files.ts: loopback peer only (403), safePath plus realpath containment (400), exists (404), /usr/bin/open -R on darwin with a 10s timeout, 501 elsewhere. 2. revealFile client helper. 3. FolderSearch IconButton in FilePane header, gated on a desktop Mac browser at a loopback host. 4. files.test.ts refusal cases, revealCommand and isLoopbackAddress units.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Code review (high) found 7 issues; fixed 6: remote-daemon gating (server now refuses non-loopback peers via requestIP, which rootRoutes now threads through; client also requires a loopback host), duplicated toast text, symlink escape, directories answering 404, no spawn timeout, PATH-resolved open. Not fixed: the spawn success path has no test seam, so it stays untested in the suite. Verified live on port 4599: README.md and src/ selected in Finder (osascript read-back). bun run test: 1898 + 440 pass; tsc clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
File tabs get a Show in Finder button (desktop Mac browser on a loopback host). POST /api/{tasks,projects}/:id/reveal runs /usr/bin/open -R after refusing non-loopback peers (403), escaping or symlinked-out paths (400), missing paths (404) and non-macOS daemons (501). Verified in the browser and via Finder's selection; both test runners pass.
<!-- SECTION:FINAL_SUMMARY:END -->
