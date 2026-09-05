---
id: TASK-33
title: Mobile pass on the new shell
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-29 00:03'
updated_date: '2026-09-05 08:08'
labels:
  - frontend
  - mobile
milestone: m-5
dependencies:
  - TASK-28
documentation:
  - docs/v2-architecture.md
ordinal: 33000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Risk 6 (§9): v1 has real accumulated mobile work — touch scrolling in the alt buffer, pinch, keyboard viewport, sidebar sheets. Below the mobile breakpoint force a single tab group and render both sidebars as sheets. Re-verify every v1 touch fix on the new shell explicitly.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Below the mobile breakpoint there is exactly one tab group and split is unavailable
- [x] #2 Task list and Explorer open as sheets on mobile
- [ ] #3 Alt-buffer touch scrolling, pinch, and keyboard viewport handling work as in v1 (checked on a real device)
- [x] #4 The composer is usable on a phone
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Findings: AppShell already floats both sidebars as sheets over a scrim below 768px; Terminal.tsx's touch/pinch/alt-buffer code and the visual-viewport hook are byte-identical to v1; drag can only drop into an existing group. What is missing: nothing forces one group or refuses split on a phone, the sheets start open on every load, selecting a task or opening a tab from a sheet leaves it covering the result, and useIsMobile is false for the first render.
2. use-mobile.ts: initialise synchronously from matchMedia so the first render on a phone is already mobile.
3. layout-store.ts: LayoutEnv { singleGroup } threaded through canSplit and commandAvailable; mergeGroups(layout) folds every group into one (left-to-right, deduped by key, active tab kept, identity on one group). Unit tests.
4. TabArea, useShellKeymap, actionEntries/CommandPaletteHost take env so the strip, the chord and the palette row agree. In single-group mode the strip omits Split rather than greying it.
5. TaskShell: env from isMobile; an effect merges a stored split when mobile; on mobile one transient 'sheet' state (tasks | explorer | null) replaces the two open flags, so sheets start closed, one shows at a time, and selecting a task, New task, or opening a tab from the Explorer closes it. Desktop behaviour unchanged.
6. Composer: autoFocus only above the breakpoint (TASK-79), tighter padding on mobile, the ⌘⏎ hint hidden on coarse pointers. Render test for the autofocus split.
7. Verify: tsc, both runners, then a narrow-window browser pass over the isolated instance. Real-device touch check (AC 3) is left for the user; the code is unchanged from v1.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Build against `frontend/components/v2/` — the v2 design system is the new UI, not a parallel track (CLAUDE.md, "The v2 design system is the new UI"). `AppShell` and the shell components already exist from TASK-46; this task supplies their data. Do not extend `components/ui/` (v1 shadcn) for new surfaces.

Verified in Chrome at 500px (Chrome's minimum window width, below the 768 breakpoint): both sheets start shut on load; the task list floats over a scrim and picking a task dismisses it; the Explorer rail opens its sheet and opening a file from Changes opens the tab and dismisses it; no Split control in the strip; a two-group layout written to localStorage came back as one group with both tabs. Composer renders with tighter padding and no caret on load. AC 3 left unchecked: Terminal.tsx's touch/pinch/alt-buffer code and the visual-viewport hook are unchanged from v1, but the real-device check is not something a desktop browser can do.

Review follow-ups (code-review --fix): the single-group fold moved out of a post-paint effect into useTaskLayout(taskId, env) — folded on load, on every write, and in the render that crosses the breakpoint — so a phone never paints the split, no sibling effect can overwrite the merge, and a desktop window dragged narrow without editing keeps its stored split; setLayout returns the committed layout so layoutRef follows the fold. mergeGroups keeps the agent's group id (splitTab leaves the right group in front, so the old rule remounted every terminal pane). sheet resets when the viewport leaves mobile; the palette's task/new-task/focus-tab rows go through the shell's sheet-dismissing doors; an open from the Explorer sheet is permanent (the pin double-tap has nothing to land on once the sheet closes). useIsMobile's query is now the exact complement of Tailwind's md (48rem).
<!-- SECTION:NOTES:END -->
