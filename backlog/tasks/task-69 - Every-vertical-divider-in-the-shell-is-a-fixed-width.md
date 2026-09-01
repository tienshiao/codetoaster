---
id: TASK-69
title: Every vertical divider in the shell is a fixed width
status: To Do
assignee: []
created_date: '2026-09-01 00:06'
updated_date: '2026-09-01 00:06'
labels:
  - frontend
  - ui
  - polish
milestone: m-5
dependencies: []
ordinal: 69000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
None of the shell's columns can be resized. The widths are constants:

- the task sidebar — `--w-sidebar: 15rem` in `index.css`, applied as `w-sidebar` in `AppShell`
- the Explorer — `--w-sidebar-right: 17rem`, applied as `w-sidebar-right`
- the diff view's file tree — `w-[280px]` inline in `DiffLayout`
- the file browser's tree, which goes through the same `DiffLayout`

240px of task list is not much for a task called `codetoaster · feature/some-long-branch`, and 280px of file tree is not much for a deep path — and in both cases the pane beside it has room to spare on a wide screen. The user cannot give it any.

Two things already exist and should be reused rather than reinvented.

`resizeFlex` in `components/tabs/drag.ts` is the arithmetic for dragging the boundary between two tab groups: pixels in, flex shares out, with a floor so a pane cannot be dragged to nothing. It is pure and tested, and the same shape of problem. The DOM half — the grab handle, pointer capture, the cursor — is in `TabArea` and is the part to generalise.

`explorer-store.ts` with `use-explorer-panel` is the persistence precedent: per device, in `localStorage`, read synchronously during render so nothing paints the default and then jumps.

Widths must survive a window that is a different size than it was when they were set, which is why the group splits store shares rather than pixels — a sidebar is different (it should keep its pixels while the main area absorbs the change), but the floor and the clamp-on-resize are the same problem and the same trap.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The task sidebar, the Explorer, and the diff/file tree can each be resized by dragging their divider
- [ ] #2 A divider has a grab area wider than the 1px border it draws, and shows a resize cursor
- [ ] #3 A width cannot be dragged to nothing — there is always enough left to grab and drag back
- [ ] #4 Widths persist per device and are read during render, so no panel paints its default and then jumps
- [ ] #5 A stored width wider than the window it is restored into is clamped rather than pushing the main area off screen
- [ ] #6 A drag does not select text in the panes it crosses
- [ ] #7 The geometry is a pure function with tests, as resizeFlex already is; reuse it rather than adding a second answer
<!-- AC:END -->
