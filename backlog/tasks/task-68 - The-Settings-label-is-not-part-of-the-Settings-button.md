---
id: TASK-68
title: The Settings label is not part of the Settings button
status: Done
assignee:
  - '@claude'
created_date: '2026-09-01 00:06'
updated_date: '2026-09-01 00:14'
labels:
  - frontend
  - ui
  - polish
milestone: m-5
dependencies: []
ordinal: 68000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`AppShell`'s sidebar footer draws an `IconButton` and then a bare `<span>Settings</span>` beside it. The word reads as the button's label and behaves as dead text, so the whole affordance is a 16px gear — the smallest target in the shell, for the only way into settings.

Every other label-plus-icon pair in the shell is one control. This one is two elements that only look like one.

The fix is not to wrap the span in an `onClick`: that gives a click target with no focus, no role and no keyboard. The pair should be a single button — the gear and the word inside it — which also makes the footer's hover and focus ring cover what a user is actually aiming at.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Clicking the word Settings opens settings, exactly as the gear does
- [x] #2 It is one control: one tab stop, one accessible name, one focus ring around the icon and the word together
- [x] #3 The footer's other content — the endpoint at the trailing edge — is unaffected and stays outside the button
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Replace the `IconButton` + `<span>` pair in `AppShell`'s sidebar footer with a single `Button`. `IconButton` cannot be the answer — it is square by construction (`size-[22px]`, grid-centred) and has nowhere to put a label. `Button` at `variant="ghost" size="sm"` is what the footer was already drawing by hand: `text-muted-foreground`, `hover:bg-hover`, `rounded-md`, icon before children. The container's `pl-2.5` drops to `pl-1` so the button's own `px-2` puts the gear back where it was, and the hover fill reads as inset from the edge rather than flush against it. No `aria-label`: the visible word is the accessible name, and a `title` repeating it would be a tooltip for text already on screen.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
`Button variant="ghost" size="sm" icon={Settings}` with `Settings` as children. One `<button>`, one tab stop, accessible name from the visible word, and the hover fill now covers what a user is aiming at rather than a 13px glyph beside it.

Wrapping the `<span>` in an `onClick` was the tempting non-fix: a click target with no role, no focus and no keyboard.

Verified in Chrome at :4599 — the hover fill spans the gear and the word as one chip, and clicking the *word* opens the dialog. `tsc --noEmit` clean; 119 render tests pass, including a new one asserting the label is inside the control, which is what fails if it goes back to being a sibling.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The sidebar footer's Settings gear and its caption are now one Button instead of an IconButton beside dead text, so the word is clickable, there is one tab stop, and the focus ring and hover fill cover the whole affordance rather than a 13px glyph. Verified in the browser and covered by a render test.
<!-- SECTION:FINAL_SUMMARY:END -->
