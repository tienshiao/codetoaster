---
id: TASK-78
title: Hover-revealed row actions are invisible but still clickable
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-01 17:57'
updated_date: '2026-09-01 21:49'
labels:
  - frontend
  - ui
  - mobile
milestone: m-5
dependencies:
  - TASK-33
references:
  - src/frontend/components/v2/AppShell.tsx
ordinal: 78000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Both hover-revealed action strips in the sidebar — `RowActions` (AppShell.tsx:161) and the project group's strip (AppShell.tsx:455) — hide themselves with `opacity-0` and nothing else. Opacity does not remove a hit target, so every button in those strips is clickable while fully invisible.

On a pointer this is nearly harmless: the strip only fails to be visible when the pointer is not on the row, and moving the pointer onto it reveals it first. On touch there is no hover, so the strip is never revealed and the buttons are permanently invisible and permanently live. TASK-77 widened the project strip by one button, so the right end of a project header now navigates to the composer on a tap that was meant to collapse the group.

The obvious fix is `pointer-events-none` alongside the `opacity-0`, re-enabled in the same `group-hover`/`group-focus-within` variants. It is filed rather than applied because it is a convention both strips share deliberately, and because the touch answer may not be "reveal on hover, hidden otherwise" at all — a phone may want the actions always visible, or behind a long-press. That is TASK-33's call, on a device.

Note for whoever takes it: `RowActions`' doc comment already explains that opacity paints the whole subtree regardless of a descendant's position, which is why anything outliving the hover portals out. `pointer-events` has the same reach, so a portalled dialog opened from the strip is unaffected, but anything left inline is not.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The buttons in RowActions and in the project group's action strip are not clickable while the strip is hidden
- [x] #2 Tapping the right end of a project header on a touch device collapses the group rather than opening the composer
- [x] #3 A dialog or menu opened from a row action still works once the pointer leaves the row (portalled content is unaffected)
- [ ] #4 Whatever touch affordance TASK-33 settles on for row actions is applied to both strips, not just one
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Pair pointer-events-none with the existing opacity-0 on RowActions and on the project group's strip, re-enabled in the same group-hover/* and group-focus-within/* variants. 2. Extend the doc comments: opacity and pointer-events both reach the whole subtree, so portaled content is outside both. 3. Tests in TaskSidebar.render.tsx: hidden strip has no hit target and the reveal re-enables it (both strips); a portaled dialog's ancestor chain carries neither opacity-0 nor pointer-events-none; the project header stays a live toggle beneath its hidden strip. 4. AC #4 (the touch affordance) stays open, deferred to TASK-33's on-device verdict; note it in a comment. The same pattern also exists in v1 DiffFile.tsx, out of scope here, flag for the user.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification (2026-09-01): bun run test:render green (20 files / 168 tests, incl. 24 in TaskSidebar.render.tsx); bunx tsc --noEmit exit 0. Authoritative CSS check per user's suggestion: bun run build:server, then grepped dist-executables/codetoaster — compiled Tailwind 4.2 output contains .pointer-events-auto{pointer-events:auto} and all four named-group rules: .group-hover\/project\/row\:pointer-events-auto {&:is(:where(.group\/project|row):hover *){@media (hover:hover){&{pointer-events:auto}}}} and the focus-within equivalents (not hover-gated, so keyboard reveal on touch-capable keyboards works too). bun test (unit) shows 276 fails, all 'Failed to open PTY' in lib\/xtmux PTY-spawn tests — sandbox environment limitation, unrelated to this change (CSS class strings + render test only).

Regression check for the unit suite: 276 unit-test failures in this environment (all PTY-spawn / agent-transcript tests; 'Failed to open PTY' and EPERM on ~/.claude writes) are pre-existing — rerunning the same files with this task's diff stashed yields the identical 276-test failure set. No unit test imports AppShell or TaskSidebar. Render suite (the runner covering both changed frontend files) is fully green.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude
created: 2026-09-01 21:46
---
Scope decision with user: fix applied now, AC #4 (the touch affordance for both strips) stays open and is deferred to TASK-33's on-device verdict — this fix is safe under either outcome (hidden implies non-interactive holds whether TASK-33 makes actions always visible or long-press). AC #2 is verified by mechanism here (hidden strip is no longer a hit target, so a tap on a project header's right end lands on the header button and collapses the group; render test asserts onToggle fires); the actual on-device tap is part of TASK-33's device pass. Out-of-scope flag, not fixed: v1 DiffFile.tsx (lines ~105 and ~426) has the same opacity-0-only pattern on its Add-comment / comment buttons — worth a task of its own if v1 gets another pass.
---
<!-- COMMENTS:END -->
