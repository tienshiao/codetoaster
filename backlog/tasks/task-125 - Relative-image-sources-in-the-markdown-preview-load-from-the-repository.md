---
id: TASK-125
title: Relative image sources in the markdown preview load from the repository
status: To Do
assignee: []
created_date: '2026-10-03 01:08'
labels:
  - frontend
dependencies:
  - TASK-122
ordinal: 127000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up to TASK-122. An image like ![arch](diagrams/arch.png) in a previewed file resolves against the app URL and shows broken. Resolve the src the same way links are (markdown-links.ts) and point it at the working-tree image endpoint (rootApi(root)/image?file=). External and data: sources stay as they are.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A relative or /-prefixed image in the preview loads from the repository
- [ ] #2 External and data: image sources are unchanged
- [ ] #3 A rendering test covers the rewritten src
<!-- AC:END -->
