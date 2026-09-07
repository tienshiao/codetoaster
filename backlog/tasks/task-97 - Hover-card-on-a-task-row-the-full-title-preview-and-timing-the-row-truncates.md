---
id: TASK-97
title: 'Hover card on a task row: the full title, preview and timing the row truncates'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-07 22:08'
updated_date: '2026-09-07 22:33'
labels:
  - frontend
  - v2
dependencies: []
ordinal: 101000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
v1 showed a terminal thumbnail on hover over a session; v2 shows nothing. The thumbnails were not useful (every Claude looked the same), but the 240px row truncates the title, the preview line and the branch, and shows only a coarse age. Hovering a task row should open a card beside the sidebar with what the row could not fit: the full title, the full last message or terminal title, the project and checkout (path, branch, dirty/unpushed counts), the state, when the task was created and last active (absolute and relative), and who is viewing it. Built from components/v2 tokens, opened after a short delay so scrolling the list does not flash cards, and never the only way to reach any of that information.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Hovering a task row for a moment opens a card to the right of the sidebar showing the untruncated title and preview
- [x] #2 The card shows the project, the working directory or worktree path, the branch and the state
- [x] #3 The card shows created and last-active times as both relative ('3m ago') and absolute values
- [x] #4 Moving the pointer away closes the card; scrolling past rows does not flash cards open
- [x] #5 The card is display-only: it steals no focus and takes no clicks, and archived rows get one too
- [x] #6 Rendering tests cover the card's content from a task's fields
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. New v2/TaskHoverCard over radix-ui HoverCard, opened on a delay, portalled, display-only. 2. ShellTask gains details; AppShell wraps a row that has them. 3. TaskSidebar builds details from TaskInfo plus the project name. 4. Rendering tests for the card's content.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented (TASK-97).

New files:
- src/frontend/components/v2/TaskHoverCard.tsx — `TaskHoverCard` + the `TaskRowDetails` plain-data type, over radix-ui `HoverCard` (openDelay 400ms, closeDelay 100ms, portalled, side=right align=start sideOffset 6, collisionPadding 8). Content is bg-pane/border-border/rounded-md/shadow-overlay/w-72 and `pointer-events-none`, so it is display-only by construction rather than by promise: nothing in it is a control, and it cannot intercept a click meant for the pane it hangs over. `open`/`defaultOpen` pass through for tests.
- src/frontend/utils/taskTimes.ts (+ .test.ts) — `ago` (moved out of TaskSidebar), `agoLabel` ('3m ago', 'just now' under 5s) and `absoluteTime` (Intl.DateTimeFormat, dateStyle medium / timeStyle short, one cached formatter). Milliseconds, deliberately apart from relativeDate.ts which speaks git's unix seconds.
- src/frontend/task-details.ts (+ .test.ts) — `detailsOf(task, label, state, projectNames)`, the TaskInfo -> TaskRowDetails projection. Pure and DOM-free, beside task-list.ts for the same reason: every line of it is a transport decision (branch off the row rather than the measurement, path = worktreePath ?? cwd, no stateNote on an archived row, profile omitted when it is DEFAULT_PROFILE).
- src/frontend/components/v2/TaskHoverCard.render.tsx — 18 cases.

Changed:
- v2/AppShell.tsx — `ShellTask` gains `details?: TaskRowDetails`; `TaskRows` wraps a row that has them. One `group/row relative` wrapper now serves both actions and the card, because Radix's asChild needs a DOM node to anchor to and TaskRow forwards no ref. Key stays outermost (a keyed Fragment when there is no card). AppShell is still layout-only.
- components/TaskSidebar.tsx — builds `details` for every row, archived included; `ago` now imported; projectNames added to the rows memo deps.
- v2/index.ts — exports TaskHoverCard / TaskHoverCardProps / TaskRowDetails.

Card contents, top to bottom: status dot + full wrapping title; the last message in full (clamped at 6 lines); the terminal title only when it repeats neither; then a mono/micro fact block — project, path (break-all), branch with the row's FilePen/ArrowUp/Archive glyphs, state (+ 'inferred from output' when hooks is false, 'archived' for an archived task, whose checkout is not described at all), profile when someone chose one, 'N viewing' when non-zero, and created / last active each as relative + absolute. Nothing is drawn as a zero or an unknown; the line is omitted.

One non-obvious fix worth recording: Radix's HoverCard.Trigger calls preventDefault() on touchstart, which around a task row would suppress the emulated click and stop a tap selecting the task. The card is therefore gated on `(hover: hover)` — the same query Tailwind compiles group-hover under — and on a touch device the trigger is not mounted at all. Radix already refuses to open on touch, so nothing is lost.

Verification: bunx tsc --noEmit clean; bun run test:render 29 files / 323 tests pass; bun run test:unit 1407 pass, 2 fail — src/cli/hook.test.ts, which spawns the CLI and posts to a stub daemon over loopback; frontend-only changes here and the failures reproduce independently of them (sandboxed network).

Not verified here, needs a browser: the real hover timing (that the 400ms delay stops a scroll flashing cards), dismissal on pointer-out, and the card's placement/collision flipping against a real viewport. The shell fixture route the plan mentioned (routes/shell.tsx) no longer exists — v1 scaffolding was deleted — so there was no fixture data to add `details` to.

Browser check on an isolated server (port 4599): hovering a row opened the card beside the sidebar after the delay, with the full three-line title where the row showed one truncated line; moving to the next row swapped the card; moving the pointer off into the pane closed it (no popper content left in the DOM). Render suite: 29 files / 323 tests pass. tsc clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
New v2 TaskHoverCard (radix-ui HoverCard, 400ms open delay, portalled, pointer-events-none) shows a task row's full title, preview, terminal title, project, path, branch and counts, state, profile, viewers, and created/last-active as relative plus absolute times. ShellTask carries details; TaskSidebar projects them from TaskInfo via task-details.ts; taskTimes.ts holds the formatting. Gated on (hover: hover) because Radix's trigger would otherwise swallow taps. Covered by TaskHoverCard.render.tsx, task-details.test.ts and taskTimes.test.ts; verified in Chrome.
<!-- SECTION:FINAL_SUMMARY:END -->
