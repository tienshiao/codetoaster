---
id: TASK-69
title: Every vertical divider in the shell is a fixed width
status: Done
assignee:
  - '@claude'
created_date: '2026-09-01 00:06'
updated_date: '2026-09-01 02:20'
labels:
  - frontend
  - ui
  - polish
milestone: m-5
dependencies: []
modified_files:
  - src/frontend/components/tabs/drag.ts
  - src/frontend/components/tabs/drag.test.ts
  - src/frontend/pane-size-store.ts
  - src/frontend/pane-size-store.test.ts
  - src/frontend/hooks/use-pane-width.ts
  - src/frontend/hooks/use-pane-width.render.tsx
  - src/frontend/components/v2/ResizeHandle.tsx
  - src/frontend/components/v2/AppShell.tsx
  - src/frontend/components/diff/DiffLayout.tsx
  - src/frontend/components/git/CommitDetail.tsx
  - src/frontend/components/tabs/TabArea.tsx
  - src/frontend/index.css
  - src/frontend/explorer-store.test.ts
  - test/local-storage.ts
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
- [x] #1 The task sidebar, the Explorer, and the diff/file tree can each be resized by dragging their divider
- [x] #2 A divider has a grab area wider than the 1px border it draws, and shows a resize cursor
- [x] #3 A width cannot be dragged to nothing — there is always enough left to grab and drag back
- [x] #4 Widths persist per device and are read during render, so no panel paints its default and then jumps
- [x] #5 A stored width wider than the window it is restored into is clamped rather than pushing the main area off screen
- [x] #6 A drag does not select text in the panes it crosses
- [x] #7 The geometry is a pure function with tests, as resizeFlex already is; reuse it rather than adding a second answer
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Geometry, in `components/tabs/drag.ts` beside `resizeFlex` so there is one geometry module: `clampPaneWidth(px, pairPx, minPx, minRestPx)` and `nextPaneWidth(startPx, deltaPx, side, pairPx, ...)`. Pure, tested. `resizeFlex` itself is not callable here — it converts to flex shares, and a sidebar must keep its pixels — but the *pair* it is built on (the two panes either side of a divider, total invariant for the length of a gesture) is exactly the model used.
2. `pane-size-store.ts` + tests, modelled on `explorer-store.ts`: one localStorage key holding a validated `Record<paneId, number>`, never throwing. The storage stub is lifted out of `explorer-store.test.ts` into `test/local-storage.ts` and shared.
3. `hooks/use-pane-width.ts`: reads the stored width synchronously during render (AC4). **The stored width is the only width the hook holds, and only a drag ever changes it.** Fitting it into a window too narrow to grant it is left to flexbox — the pane hands the layout a shrinkable `flex-basis` with a `min-width` floor, and the sibling carries a floor of its own (AC5).

   *(Revised during implementation. The first version measured the pane against its neighbour and clamped in a `ResizeObserver`, keeping desired and effective widths apart. It passes its unit tests and oscillates in a real browser: the shell has two sidebars sharing one main area, so the room one gives up is room the other immediately takes and gives back — 552 observer callbacks in under a second, settling on whichever phase it stopped in. The constraint is over all three panes at once, which is what the flex algorithm already solves in one pass.)*
4. `components/v2/ResizeHandle.tsx`: the DOM half generalised out of `TabArea` — `role="separator"`, wide grab area pulled over the 1px border, `cursor-col-resize`, arrow-key nudge, pointer/cancel listeners released on unmount, and a `data-resizing` attribute on `<body>` (CSS in `index.css`) so the cursor holds and nothing selects across the panes the drag crosses (AC2, AC6).
5. Wire it: `AppShell` left sidebar and Explorer, `DiffLayout` file tree (which is also the file browser tree), and `CommitDetail`'s tree, which is the same 280px tree in the git view. `TabArea` uses the same `ResizeHandle` so there is one grab handle in the app (AC7).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
All four dividers drag, persist per device, and were verified in Chrome against a real layout — which is where the design changed, so the browser pass was not optional here.

**What the tests could not see.** The first `use-pane-width` kept the width the user asked for apart from the width that currently fits, clamping the second in a `ResizeObserver`. Ten render tests passed, because a render test models one pane. In the browser two sidebars share one main area: each clamped against `pane + main`, a total that is not invariant when the *other* pane also moves, so the room one gave up was room the other took and gave back — 552 observer callbacks in under a second, landing on whichever phase it stopped in. The shipped version hands the layout a shrinkable `flex-basis` with floors on both sides and lets flexbox solve all three at once. The render tests now assert that contract rather than the arithmetic, and say why, because turning `flexBasis` back into a fixed `width` brings the loop back.

**Verified in Chrome** (isolated server on :4599):
- task sidebar 240→420→160 (floor held, handle still grabbable at x=157), Explorer 272→372 dragging *left*, diff file tree 280→180, tab groups 406/407→519/293 after the `ResizeHandle` refactor.
- Stored 900 restored into a 1500px window: sidebar renders 866, Explorer 358, main exactly on its 240 floor, no document overflow, store still `{"sidebar":900,"explorer":372}`. Narrowed to 1000 → 512/212; back to 1500 → 866/358. Stable across 1.2s of sampling.
- `getSelection()` empty after every drag; `body[data-resizing]` cleared on pointerup.

**Scope note.** `CommitDetail`'s file tree was the same hard-coded 280px and is wired too, sharing the `file-tree` id — one tree width across diff, file browser and git, since it is one preference rather than one per view.

957 unit tests and 136 render tests pass.

## Code review (`/code-review --fix`)

Four findings, all applied and re-verified. One was a real bug of mine, and the browser pass I had already done could not have caught it.

**`ResizeHandle` called the first render's `onResizeStart` forever.** `onResize` and `onResizeEnd` are read through refs; `onResizeStart` was called straight out of a `useCallback(…, [])` closure, and the comment beside it claimed the opposite. `TabArea` measures `layout.groups` in that callback, so a handle kept whatever layout existed when it mounted. My earlier check missed it because splitting *mounts* a new handle, whose first render is correct — it takes a second layout change to bite.

Re-verified in Chrome with three groups, where the first divider's handle mounted while there were only two:
- drag boundary 0: 351/352/352 → 249/454/352 (group 2 untouched). Previously a no-op — `setGroupFlex` bails on a flexes array of the wrong length.
- then drag boundary 1: → 249/555/251, group 0 holding rather than snapping back to 351.
- no document overflow.

`ResizeHandle.render.tsx` was added for it, and fails against the old code.

The other three: `localStorage` was being read-modify-written on every `pointermove`, so persistence is split out of the state update and runs on gesture end (`onNudge` still writes immediately — one key press is one width); `DiffLayout` was imposing the 240px neighbour floor even with no file tree, which could overflow a 160px tab group, so `restProps` is only worn when a tree is rendered; and `side` was missing from `onNudge`'s dependency array.

957 unit + 138 render tests pass; `tsc --noEmit` clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Every vertical divider in the shell — the task sidebar, the Explorer, the diff/file tree and the git view's tree — can now be dragged, with the width kept per device in `localStorage` and read during the first render so nothing paints a default and then jumps.

One geometry module (`clampPaneWidth`/`nextPaneWidth`, added beside `resizeFlex` in `drag.ts`) bounds every drag, and one `ResizeHandle` — generalised out of `TabArea`, which owned the only grab handle — supplies the wide target, the held cursor and the selection guard for all four, `TabArea` included.

Fitting a stored width into a window too narrow for it is left to flexbox rather than to JavaScript: the pane offers a shrinkable `flex-basis` with a floor, the sibling carries a floor of its own. Measuring and clamping in an effect was tried first and oscillates in a real browser, because the two sidebars share one main area and each takes back the room the other just gave up — the constraint is over all three panes at once. That is recorded in the code, in the plan, and in the tests that would otherwise let it back in.

Verified in Chrome against a real layout (drags exact, floors held, no overflow, no text selection, widths restored across a narrow/wide round trip with the store untouched) and by 957 unit tests and 136 render tests.
<!-- SECTION:FINAL_SUMMARY:END -->
