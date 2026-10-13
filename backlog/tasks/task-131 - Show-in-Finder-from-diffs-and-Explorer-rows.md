---
id: TASK-131
title: Show in Finder from diffs and Explorer rows
status: Done
assignee:
  - '@claude'
created_date: '2026-10-13 01:00'
updated_date: '2026-10-13 01:32'
labels:
  - frontend
dependencies: []
ordinal: 133000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-120 put Show in Finder on a file tab only. A diff has no way to it, and an Explorer row needs its tab opened first. Diff file headers get the same button, and a right-click on an Explorer row (a Changes file, a Files entry, a Backlog card) offers Show in Finder without opening anything. Same loopback-only gating and the same reveal route as TASK-120.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A diff tab and each file header of the working-tree Changes diff show a Show in Finder button that reveals that file; a deleted file and a commit's diff show none
- [x] #2 Right-clicking a file in the Explorer's Changes section, any entry (directories included) in its Files section, or a Backlog card opens a menu whose Show in Finder reveals that path
- [x] #3 Where Finder cannot be shown (not a desktop Mac browser at a loopback host) neither the button nor the menu appears, and the browser's own context menu is left alone
- [x] #4 A failed reveal is reported in a toast
- [x] #5 Rendering tests cover the button, the three Explorer menus and the gated-off case
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. hooks/use-reveal.ts: useRevealInFinder(root) (undefined when canRevealInFinder is false, toast on failure) and useRevealMenu(root) (a row onContextMenu plus PointMenu props). 2. DiffFile header button behind a new onRevealFile prop threaded through DiffLayout; DiffFilePane and DiffView pass it, CommitDetail does not. 3. onRowContextMenu on both file trees and on BacklogCard; the Explorer's Changes, Files and Backlog sections mount one PointMenu each. 4. FilePane moves onto the hook. 5. Rendering tests first for each surface; wiki file-viewer page, index and log.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Code review (high) raised 7 findings; 3 fixed: a menu unmounted while open reopened by itself when its list came back (PointMenu now reports an unmount-while-open as a dismissal, which also covers the terminal file chooser), a menu left open across a root change offered the old root's path (useRevealMenu closes on a root change), and the header button class was a third copy (one constant). Checked and not a defect: a second right-click while the menu is open does move it, seen in Chrome. Left: a shared point-menu hook with use-path-links, the tree re-rendering once per menu open, and no render test of the DiffFilePane and DiffView wiring (checked in the browser instead).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Diff file headers of the working-tree diff (a diff tab and the Changes diff) get a Show in Finder button, and a right-click on an Explorer row (a Changes file, any Files entry, a Backlog card) opens a one-row menu that reveals the path without opening a tab. All of it goes through one hook, use-reveal.ts, which carries the loopback-Mac gate and the failure toast, and the file tab moved onto it; the reveal route is unchanged. Review: 3 of 7 findings fixed, see notes. Verified on an isolated server on port 4599 in Chrome: the Files, Changes and Backlog menus and the diff header button each selected the right item in Finder (read back with osascript), and the menu re-anchors on a second right-click. bun run typecheck clean; vitest 540 pass; bun test 2036 pass with 3 failures, all in watcher.test.ts, which fails the same way on an untouched v2 checkout under this machine's load.
<!-- SECTION:FINAL_SUMMARY:END -->
