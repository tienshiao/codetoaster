---
id: TASK-121
title: Switch between a file's diff and its full contents
status: Done
assignee:
  - '@claude'
created_date: '2026-09-29 07:32'
updated_date: '2026-09-29 07:42'
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
- [x] #1 Each file header in the working-tree diff (Changes tab and diff tab) has a View file button that opens a file tab scrolled to the first changed line
- [x] #2 View file is absent for a deleted file and in the read-only commit diff
- [x] #3 A file tab shows a Show changes button only while the file is in the working-tree diff, and it opens that file's diff tab
- [x] #4 Switching back and forth reuses the existing tabs rather than opening duplicates
- [x] #5 The first-changed-line rule is unit tested
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. utils/firstChangedLine.ts plus a unit test: first change in diff order, a deletion landing on the line that now follows it. 2. DiffFile gets onViewFile and a FileText header button, hidden for deleted files. 3. DiffLayout passes it through; DiffView and DiffFilePane pass their onOpenFile. 4. FilePane gets onOpenDiff and a FileDiff header button, gated on useChangedPaths (shared diff query, one parse per response); TabPane wires it to open the diff tab.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Code review (high) found 2 low issues, both fixed: deletion-only hunks landed on newStart (the first context line) instead of the deletion; useTaskDiff in every file tab re-parsed and word-diffed the whole tree per tab, replaced by useChangedPaths (select plus a WeakMap keyed by the response). Verified in the browser on port 4599: View file from a diff tab opened the file at its first added line, Show changes returned to the same diff tab (no duplicate), Changes tab headers carry View file, an unchanged README has no Show changes. bun run test: 1904 + 440 pass; tsc clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Working-tree diff file headers (Changes and per-file diff tabs) have View file, opening the file tab at the first change; file tabs have Show changes while the file is in the working-tree diff, opening its diff tab. Tabs dedupe by key, so switching back and forth reuses two tabs. Commit diffs and deleted files get no View file.
<!-- SECTION:FINAL_SUMMARY:END -->
