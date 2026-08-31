---
id: TASK-57
title: 'Mutation failures are reported twice: inline and as a toast'
status: Done
assignee:
  - '@claude'
created_date: '2026-08-30 22:11'
updated_date: '2026-08-31 00:10'
labels:
  - frontend
milestone: m-3
dependencies: []
ordinal: 57000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Every mutation in `TaskContext` goes through `request()` (src/frontend/TaskContext.tsx:130), which calls `toast.error(failure, ...)` on both the network-failure and the non-2xx path before returning `{ ok: false, error }`. Callers that also render the failure in place therefore show it twice. The composer (src/frontend/components/Composer.tsx:102) is the first: a failed create puts the message under the textarea *and* raises a toast saying the same thing.

Left as-is when the composer landed (TASK-24) because the toast is the app-wide behaviour and suppressing it there alone would have been the inconsistency. But two surfaces for one error is a decision that should be made once, deliberately, rather than accreting a second inline site at a time.

The choice is roughly: `request()` stops toasting and each caller owns its own presentation (toast where there is nowhere to put it, inline where there is); or `request()` grows a way for a caller to opt out of the toast because it is showing the error itself. Either is fine — pick one and apply it to the composer as the first consumer.

Cosmetic, no data at risk. Worth doing before more panes grow inline error slots.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A failed task create shows its error in exactly one place
- [x] #2 Mutations with no inline error surface still report failures visibly (the toast does not simply disappear everywhere)
- [x] #3 The chosen rule is expressed in TaskContext's request() rather than by convention at each call site
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Take the second option the task describes: `request` keeps toasting, and grows an opt-out for the caller that is already showing the message.

The alternative — `request` stops toasting, every caller reports for itself — is what AC #3 rules out, and rightly: most mutations here are fire-and-forget (`void renameTask(...)`, the sidebar's close, resume, the shell open/close) with nowhere to put an error, and a component with nowhere to put one should not have to think about this.

The opt-out is per *call*, not per mutation, and that is the point: `createTask` is reached from the composer, which has a slot under its textarea, and from the sidebar's New task button, which has none. Only the component knows which it is.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
`request` takes a `RequestOptions` bag whose `inline` flag means 'the caller renders this failure itself'; the reporting decision is a single `report()` closure at the top of the function, so the rule is legible in one place rather than repeated at each return. `createTask` threads it through; the composer passes `{ inline: true }` and nothing else does.

The composer was the only inline error surface in the app — checked the rename and close dialogs, which show none and rely on the toast, which is now stated rather than accidental.

Two tests, both confirmed to fail against the old code: `Composer.render.tsx` asserts the composer asks for `inline`, and `TaskContext.render.tsx` drives a failing create both ways and asserts exactly one report each — no toast with `inline`, a toast without it, which is AC #2 in the same test as AC #1.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`TaskContext.request` reports every mutation failure as a toast unless the caller passes `{ inline: true }` to say it is showing the message itself — the rule stated once, in the function that does the reporting. The composer, the app's only inline error surface, opts out; nothing else changes, and the fire-and-forget mutations keep the toast they depend on.
<!-- SECTION:FINAL_SUMMARY:END -->
