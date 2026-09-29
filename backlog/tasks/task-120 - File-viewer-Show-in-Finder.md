---
id: TASK-120
title: 'File viewer: Show in Finder'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-29 06:04'
updated_date: '2026-09-29 06:04'
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
- [ ] #1 A file tab header shows a Show in Finder button when the browser is on macOS
- [ ] #2 Clicking it reveals and selects the file in Finder via POST /api/tasks/:id/reveal (and the projects equivalent)
- [ ] #3 The route rejects a missing or escaping path (400), a missing file (404), and a non-macOS daemon (501)
- [ ] #4 Tests cover the route's refusals without launching Finder
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. POST reveal route in api/files.ts: safePath, exists, open -R on darwin, 501 otherwise. 2. revealFile client helper. 3. FolderSearch IconButton in FilePane header, gated on a macOS browser. 4. files.test.ts cases for 400/404/501.
<!-- SECTION:PLAN:END -->
