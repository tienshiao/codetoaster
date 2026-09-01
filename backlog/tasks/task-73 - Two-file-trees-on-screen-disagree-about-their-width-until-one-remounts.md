---
id: TASK-73
title: Two file trees on screen disagree about their width until one remounts
status: To Do
assignee: []
created_date: '2026-09-01 03:39'
labels:
  - frontend
  - ui
  - bug
milestone: m-5
dependencies: []
ordinal: 73000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by code review during TASK-67; introduced by TASK-69.

`DiffLayout` and `CommitDetail` both call `usePaneWidth("file-tree", "left")`, and a split layout can mount two of them at once — two diff panes, or a diff beside a commit. Sharing one id was deliberate: a tree width is one preference, not one per view.

What was missed is that `usePaneWidth` holds the width in its own `useState` and `pane-size-store` has no subscriber list. So dragging one tree writes storage and re-renders only that hook; the other pane keeps its old width until it remounts, and then jumps to a width the user set some time ago in a pane they may have since closed.

`explorer-store` has the same shape and gets away with it because one Explorer is mounted at a time. `view-state-store` is the precedent for the fix: a listener map keyed finely enough that a subscriber is only woken for the value it reads.

Not fixed in review because it needs a subscriber list rather than a patch, which was outside that diff's intent. Low severity — the panes converge on remount and nothing is lost — but it is visible.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Dragging one file tree's divider moves every other file tree on screen in the same gesture
- [ ] #2 A pane mounted after a drag opens at the width the drag set, not at a stale one
- [ ] #3 The store wakes only the hooks that read the pane it changed, not every consumer
- [ ] #4 Unsubscribing on unmount is covered, so a closed pane leaves no listener behind
<!-- AC:END -->
