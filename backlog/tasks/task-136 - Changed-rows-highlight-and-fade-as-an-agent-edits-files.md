---
id: TASK-136
title: Changed rows highlight and fade as an agent edits files
status: To Do
assignee: []
created_date: '2026-11-05T06:59:00Z'
labels:
  - frontend
dependencies: []
ordinal: 138000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
While an agent works, the Explorer lists (Changes, Files, Backlog), file trees and open diffs update in place, but nothing marks what just changed, so you cannot tell which file the agent touched a moment ago without reading the whole list again. A row or hunk that changes should flash a highlight that fades over a few seconds, so where activity is happening is visible at a glance.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A row that appears in or changes in the Changes list, the Files tree or the Backlog section gets a highlight that fades out over a few seconds
- [ ] #2 An open diff or file tab whose content updates marks the changed lines or hunks the same way
- [ ] #3 Nothing highlights on first load, on a remount or tab switch, or when a list is re-fetched with no actual change
- [ ] #4 Repeated changes to the same row restart its fade rather than stacking
- [ ] #5 The highlight colour comes from a v2 semantic token and the fade is skipped under prefers-reduced-motion
- [ ] #6 Rendering tests cover a change highlighting, an unchanged refetch not highlighting, and the restart on repeat
<!-- AC:END -->
