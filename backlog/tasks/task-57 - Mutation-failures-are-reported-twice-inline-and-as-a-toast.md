---
id: TASK-57
title: 'Mutation failures are reported twice: inline and as a toast'
status: To Do
assignee: []
created_date: '2026-08-30 22:11'
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
- [ ] #1 A failed task create shows its error in exactly one place
- [ ] #2 Mutations with no inline error surface still report failures visibly (the toast does not simply disappear everywhere)
- [ ] #3 The chosen rule is expressed in TaskContext's request() rather than by convention at each call site
<!-- AC:END -->
