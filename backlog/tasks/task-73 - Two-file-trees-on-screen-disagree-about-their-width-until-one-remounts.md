---
id: TASK-73
title: Two file trees on screen disagree about their width until one remounts
status: Done
assignee:
  - '@claude'
created_date: '2026-09-01 03:39'
updated_date: '2026-09-04 21:08'
labels:
  - frontend
  - ui
  - bug
milestone: m-5
dependencies: []
modified_files:
  - src/frontend/pane-size-store.ts
  - src/frontend/pane-size-store.test.ts
  - src/frontend/hooks/use-pane-width.ts
  - src/frontend/hooks/use-pane-width.render.tsx
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
- [x] #1 Dragging one file tree's divider moves every other file tree on screen in the same gesture
- [x] #2 A pane mounted after a drag opens at the width the drag set, not at a stale one
- [x] #3 The store wakes only the hooks that read the pane it changed, not every consumer
- [x] #4 Unsubscribing on unmount is covered, so a closed pane leaves no listener behind
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. pane-size-store.ts gains a live, in-memory width per PaneId with a subscriber list keyed per pane (the view-state-store listener map is the precedent): getPaneWidth(id) (live value, seeded from localStorage on first read), setPaneWidth(id, px) (updates the live value and notifies only that pane's listeners), subscribePaneWidth(id, listener) returning an unsubscribe that drops the set when empty, and a test-only resetPaneWidths(). savePaneWidth stays the persistence step and keeps its read-modify-write. 2. use-pane-width.ts reads width with useSyncExternalStore(subscribePaneWidth(id), () => getPaneWidth(id)) instead of useState; show() calls setPaneWidth so every hook on the same pane moves in the same gesture; persist() unchanged. 3. Tests: pane-size-store.test.ts covers set/get/subscribe, that a listener on 'sidebar' is not woken by a change to 'file-tree', and that unsubscribing empties the set; use-pane-width.render.tsx covers two hooks on one id moving together during a drag, a hook mounted after a drag opening at the dragged width, and no listener left after unmount. 4. Existing beforeEach hooks that clear localStorage also call resetPaneWidths().
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
pane-size-store now holds the live width as well as the stored one: `getPaneWidth` (seeded from `loadPaneWidths` on first read, memoised so it is a legal `useSyncExternalStore` snapshot), `setPaneWidth` (no-op when unchanged; notifies only that id, walking a copy of the set because a woken hook may unmount), `subscribePaneWidth` returning an unsubscribe that drops the set when empty, plus test-only `paneListenerCount` and `resetPaneWidths`. `savePaneWidth` keeps its read-modify-write and now sets the live value first, so storage and screen cannot disagree.

`usePaneWidth` reads through `useSyncExternalStore` instead of `useState`; `show` calls `setPaneWidth`.

Departed from the plan in one place: the `latest` ref is gone and `persist` writes `getPaneWidth(id)`. With the width shared, a remembered one is a hazard the per-hook version did not have — `ResizeHandle` fires `onResizeEnd` on every pointerup including one with no move, so a click on one tree's handle would have persisted the width from before another tree's drag. Covered by a test.

`loadPaneWidth` kept: it is now the "what a reload would open at" read, which is what the persistence assertions in the render test want.

Verification: `bun test src/frontend/pane-size-store.test.ts` 24 pass / 0 fail; `bun run test:render` 20 files, 174 pass / 0 fail (14 in use-pane-width.render.tsx). `bunx tsc --noEmit` reports nothing in these files — the only errors are in src/lib/worktree/wip.test.ts, another agent's in-flight work in the same tree.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Moved the pane width out of `usePaneWidth`'s `useState` and into `pane-size-store` as a live value with per-id subscribers (the `view-state-store` listener map is the model), so the two file trees a split can show at once move together during a drag and a pane mounted afterwards opens at the width the drag set rather than at the last one written to localStorage. Listeners are keyed per pane, so the sidebar's drag does not wake them; unsubscribing on unmount drops the set when it empties. `persist` now writes the store's width rather than a per-hook ref, which also fixes a click-with-no-drag persisting a stale width over another pane's.
<!-- SECTION:FINAL_SUMMARY:END -->
