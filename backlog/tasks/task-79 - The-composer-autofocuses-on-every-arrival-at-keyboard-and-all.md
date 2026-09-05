---
id: TASK-79
title: 'The composer autofocuses on every arrival at /, keyboard and all'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-01 17:57'
updated_date: '2026-09-05 07:24'
labels:
  - frontend
  - mobile
milestone: m-5
dependencies:
  - TASK-33
references:
  - src/frontend/components/Composer.tsx
  - src/frontend/hooks/use-task-nav.ts
ordinal: 79000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-76 gave the composer's prompt `autoFocus` (Composer.tsx:192) so that the sidebar's New task button lands with a caret in the box. `autoFocus` fires on every mount of `/`, though, not only on the ones the button caused:

- the initial page load, whenever `/` is where the app opens
- the redirect in `routes/t.$slug.tsx:38` for a task that no longer exists
- any other navigation back to `/`

On a desktop a stolen focus on load is a small thing. On a phone it pops the soft keyboard over the shell before the user has asked to type, and does it again every time a dead task URL bounces them home.

`useOpenComposer` already focuses the prompt explicitly by `COMPOSER_PROMPT_ID` — it has to, for the case where `/` is already showing and nothing remounts. So the deliberate press is covered without `autoFocus` at all, and dropping the attribute would leave focus alone on the incidental arrivals. What is not settled is whether a desktop landing on `/` still wants the caret placed for it; that is a feel question, and the reason this is filed for the mobile pass rather than fixed on the spot.

One shape worth considering: keep `autoFocus` above the mobile breakpoint and drop it below, so the platform where an unbidden keyboard costs a third of the viewport is the one that does not get it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Loading / directly on a phone does not raise the soft keyboard
- [x] #2 Being redirected to / from a task that no longer exists does not raise the soft keyboard
- [x] #3 Pressing New task (header + or a project group's +) still lands with the caret in the prompt, on both desktop and touch
- [x] #4 A rendering test distinguishes an incidental mount of / from an arrival via useOpenComposer
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Folded into TASK-33: Composer's autoFocus becomes autoFocus={!isMobile}, with useIsMobile made synchronous so the first render on a phone already knows. useOpenComposer's explicit focus by id covers the deliberate press on both platforms. A Composer render test stubs matchMedia both ways and asserts where the caret lands.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verified in Chrome at 500px: loading / leaves focus on body; a dead task URL redirects to / with focus on body; the sidebar's + lands the caret in the prompt. Composer.render.tsx stubs matchMedia both ways.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
autoFocus is now autoFocus={!isMobile}, with useIsMobile seeded synchronously from matchMedia so the first render on a phone already knows. Deliberate presses still land through useOpenComposer's focus by id. Render tests cover desktop focus, mobile non-focus, and the explicit focus on mobile.
<!-- SECTION:FINAL_SUMMARY:END -->
