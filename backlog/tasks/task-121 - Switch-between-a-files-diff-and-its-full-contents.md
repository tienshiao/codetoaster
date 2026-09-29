---
id: TASK-121
title: Switch between a file's diff and its full contents
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-29 07:32'
updated_date: '2026-09-29 07:32'
labels:
  - frontend
dependencies: []
ordinal: 123000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When reviewing a diff you often want the whole file, and when reading a file you want to see what changed. Diff file headers (Changes tab and per-file diff tabs) get a View file button that opens the file tab at the first changed line; a file tab gets a Show changes button that opens that file's diff tab when it is in the working-tree diff.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each file header in the working-tree diff (Changes tab and diff tab) has a View file button that opens a file tab scrolled to the first changed line
- [ ] #2 View file is absent for a deleted file and in the read-only commit diff
- [ ] #3 A file tab shows a Show changes button only while the file is in the working-tree diff, and it opens that file's diff tab
- [ ] #4 Switching back and forth reuses the existing tabs rather than opening duplicates
- [ ] #5 The first-changed-line rule is unit tested
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. utils/firstChangedLine.ts plus a unit test. 2. DiffFile gets onViewFile and a FileText header button, hidden for deleted files. 3. DiffLayout passes it through; DiffView and DiffFilePane pass their onOpenFile. 4. FilePane gets onOpenDiff and a FileDiff header button, gated on useTaskDiff tokens:false containing the path; TabPane wires it to open the diff tab.
<!-- SECTION:PLAN:END -->
