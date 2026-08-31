---
id: TASK-67
title: 'The sidebar''s filter, grouping and archived toggle reset on every navigation'
status: To Do
assignee: []
created_date: '2026-08-31 23:57'
labels:
  - frontend
  - ui
  - bug
milestone: m-5
dependencies: []
documentation:
  - docs/v2-architecture.md
ordinal: 67000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`useTaskSidebar` holds `filter`, `grouped` and `showArchived` in `useState`. `/` and `/t/$slug` are separate route components that each render their own `TaskShell`, so navigating between them unmounts one and mounts the other, and all three go back to their defaults.

The effect: type a filter, click the task you found, and the filter box is empty — on the screen you were using it to get to. Turn on project grouping, open a task, and the grouping is gone. Turn on the archived toggle to find something you archived, click anything, and it is off again, which is the one that reads most like a bug because the rows it was showing vanish with it.

Reproduced by hand at `localhost:4599`: filtered on "gam", clicked the matching row, and the field was back to its placeholder with the full list under it. Pre-existing — it predates the archived toggle TASK-66 added, and the filter has behaved this way since TASK-28.

The fix has a decision in it, so it is not purely mechanical. Two of these are *settings* — grouping and the archived toggle are how the user wants the list arranged, and should no more reset on navigation than the Explorer's open section does. The filter is arguably a *search*, and clearing it when you act on a result is defensible. What is not defensible is that today's behaviour is neither: it is an accident of where the state happens to live, and it is the same accident for all three.

`explorer-store.ts` and `use-explorer-panel` are the precedent to follow: device-scoped state read synchronously during render and written through to `localStorage`, so nothing paints the default first and swaps. The sidebar's state is per-device and per-list, not per-task, so `view-state-store` (keyed by task) is the wrong home for it.

Lifting `TaskShell` to the root route so it is never remounted would also fix it, and is the wrong fix: it makes the routes own layout rather than addresses, which §7.3 deliberately does not do.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Project grouping survives navigating from / to a task and back
- [ ] #2 The archived toggle survives the same navigation, and the archived rows it was showing are still there
- [ ] #3 Whatever is decided for the filter — persisted, or cleared deliberately — is a choice the code states, not a side effect of remounting
- [ ] #4 The persisted state is per device and read during render, so the sidebar never paints the default and then swaps
- [ ] #5 A stored value that is no longer valid (a project id that has gone, say) does not break the list
- [ ] #6 Tests cover the state surviving a remount, since that is the whole defect
<!-- AC:END -->
