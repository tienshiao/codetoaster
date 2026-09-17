---
id: TASK-109
title: >-
  Bare file names in a task's terminals open the file, with a chooser when
  several match
status: Done
assignee:
  - '@claude'
created_date: '2026-09-17 01:22'
updated_date: '2026-09-17 22:33'
labels:
  - frontend
dependencies: []
ordinal: 111000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-108 links only paths that resolve against the task's cwd or repository root, so an agent writing Composer.tsx or panes/TabPane.tsx gets no link. Match a bare file name, or a partial path, against the ends of the task's file paths. One match opens directly. Several open a small menu at the click listing the candidates, like the diff and file views' definition/reference popover.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A bare name with an extension that matches exactly one file in the task's list is a link that opens that file, keeping any :line suffix
- [x] #2 A partial relative path (a/b.ts) that does not resolve against cwd or root matches files whose path ends in /a/b.ts on segment boundaries
- [x] #3 A name matching several files is a link; clicking it opens a menu at the pointer listing every candidate path, and choosing one opens that file at the line
- [x] #4 Candidates under the task's cwd are listed first, then by path length
- [x] #5 Extensionless bare words (build, test, LICENSE) are not linked, and paths that already resolve keep their current behaviour
- [x] #6 Unit tests cover matching and ordering; a render test covers the single-match open and the chooser
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. path-links.ts: index files by last segment; when a relative path resolves against neither cwd nor root, match it as a segment-aligned tail (extension required, ./ and ../ excluded) and rank candidates cwd-first, then by length, then by name. Matches carry paths[]. 2. v2 DropdownMenu: PointMenu, opened at a viewport point and returning focus to where it came from; mono rows. 3. usePathLinkProvider opens a single candidate and otherwise opens the menu at the click; TabPane renders it beside the terminal panes. 4. Unit tests for matching and ranking; render tests for the direct open, the chooser and Escape.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented. bun run test green (1610 unit, 372 render); tsc clean. Not yet checked in a real browser: menu placement at the click and focus returning to the xterm after the menu closes.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Bare names and partial paths in a task's terminals link to files: path-links indexes files by last segment and, when a relative path resolves against neither cwd nor root, matches it as a segment-aligned tail (extension required, ./ and ../ excluded), ranking candidates cwd-first then by path length. One candidate opens the file; several open a PointMenu at the click listing them. Verified with bun run test (1610 unit, 372 render) and tsc --noEmit, both clean; menu placement and focus return to xterm not yet checked in a real browser.
<!-- SECTION:FINAL_SUMMARY:END -->
