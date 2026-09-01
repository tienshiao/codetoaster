---
id: TASK-67
title: 'The sidebar''s filter, grouping and archived toggle reset on every navigation'
status: Done
assignee:
  - '@claude'
created_date: '2026-08-31 23:57'
updated_date: '2026-09-01 03:40'
labels:
  - frontend
  - ui
  - bug
milestone: m-5
dependencies: []
documentation:
  - docs/v2-architecture.md
modified_files:
  - src/frontend/sidebar-store.ts
  - src/frontend/sidebar-store.test.ts
  - src/frontend/TaskSidebar-state.render.tsx
  - src/frontend/components/TaskSidebar.tsx
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
- [x] #1 Project grouping survives navigating from / to a task and back
- [x] #2 The archived toggle survives the same navigation, and the archived rows it was showing are still there
- [x] #3 Whatever is decided for the filter — persisted, or cleared deliberately — is a choice the code states, not a side effect of remounting
- [x] #4 The persisted state is per device and read during render, so the sidebar never paints the default and then swaps
- [x] #5 A stored value that is no longer valid (a project id that has gone, say) does not break the list
- [x] #6 Tests cover the state surviving a remount, since that is the whole defect
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
**The decision (AC3).** Grouping, the archived toggle and the closed groups are *settings* and persist to `localStorage`. The filter survives navigation but is deliberately not persisted: it lives in the same store, and is left out of the persisted set the way `view-state-store` leaves out `hunkExpansions` — omitted rather than filtered on the way out, so it cannot be added back by accident. Booting the app into a list showing 2 of 30 tasks, with the only explanation sitting in a text box, is hidden state that hides data; surviving a navigation is the whole of the reported defect and does not need a reload to fix.

1. `sidebar-store.ts`, modelled on `explorer-store.ts`: one `localStorage` key, a `SidebarState` of `{ grouped, showArchived, closedGroups }`, a revive that validates each field and drops anything else, and IO that never throws. `filter` is deliberately not in the persisted shape.
2. The in-memory half. Four values have to outlive a remount, and `/` and `/t/$slug` mount *different* `TaskShell`s, so the state cannot live in a component. A module-level store with the persisted subset written through — `view-state-store` is the precedent for exactly this split.
3. AC5: `closedGroups` is keyed by project id and a project can be deleted, so a stored key naming a project that has gone must not keep a group closed or draw anything. `groupByProject` already only emits groups it has tasks or projects for, so the reviver keeps the record to known-good *shapes* and the render path stays keyed off the groups that exist — the stale key is simply never read. Verify rather than assume.
4. `useTaskSidebar` reads from the store during render (AC4) instead of `useState`, and its four setters write through.
5. Tests: a `.render.tsx` mounting the hook, unmounting it and mounting a second instance — the defect is precisely "survives a remount" (AC6) — plus a `.test.ts` over the store's revive/IO, including a `closedGroups` naming a project that no longer exists.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**The decision (AC3).** Grouping, the archived toggle and the closed groups persist to `localStorage`; the filter survives a navigation but is deliberately not persisted. It is omitted from `PersistedSidebarState` rather than stripped on the way out — the same choice `view-state-store` makes for `hunkExpansions` — so a field that is not in the type cannot be put back by an accident of spreading. Surviving a navigation is the whole of the reported defect; a reload that opened the app showing two of thirty tasks, with the only explanation sitting in a text box, would be hidden state that hides data.

**It was four pieces of state, not three.** `closedGroups` is keyed by project id and resets the same way, and it is what AC5 is about.

**No subscriber list.** `/` and `/t/$slug` swap rather than coexist, so exactly one `useTaskSidebar` is mounted at a time; what the state has to do is outlive the component, which a module binding does. Verified in the routes rather than assumed.

`patchSidebarState` merges against the store and never against a value a render closed over, so the stale-spread bug `use-explorer-panel` needs a `latest` ref to dodge is unrepresentable here. `toggleSidebarGroup` is a store function for the same reason, rather than a `closedGroups` patch the caller assembles.

**AC5 needs no pruning.** A deleted project leaves its id in the record, and nothing has to remove it: the list is drawn from the groups that exist and the record is only ever read by id, so a stale entry is never asked about. Pruning against the live project list would be actively worse — `projects` is empty on the first render, before the socket lands, so an eager prune would wipe every closed group on every cold load. Growth is bounded instead by dropping `false` entries on both read and write, which also matches what the field means.

**Verified.** The five remount tests were run against the pre-fix `useTaskSidebar` (stashing only that file): all five fail, all five pass with it. They are regression tests, not vacuous ones.

Driven in Chrome on an isolated server, the reported repro first: filtered on "v2 3", clicked the matching row, and on `/t/...` the box still read "v2 3" with the one row under it. Grouping and the archived toggle set on the task screen were both still on after navigating back to `/`, and the stored record held `{grouped, showArchived, closedGroups}` and no filter. A reload cleared the filter and kept both settings. A closed group stayed closed across a navigation, and reopening it removed the key rather than storing `false`. Seeding storage with a `closedGroups` naming a deleted project, plus a `false` entry and a non-boolean value, rendered the list normally with no console errors.

972 unit tests and 143 render tests pass; `tsc --noEmit` clean on the touched files.

**Correction.** The note above claimed the stale-spread bug was "unrepresentable here" because `patchSidebarState` merges against the store. That was only true of the merge. `onToggleGrouping` and `onToggleArchived` computed `!grouped` / `!showArchived` from the render's own snapshot, so the *value* being patched was still stale even though the merge was fresh — two toggles of one flag batched into a single event both compute the same answer, and the second is a no-op instead of putting the setting back. Caught in review and fixed with `toggleSidebarFlag`, which reads the live value; the claim holds now.

Also from review: `patchSidebarState` persisted unconditionally, so every filter keystroke ran a `JSON.stringify` and a synchronous `setItem` writing byte-identical content — the filter is not in the persisted shape. It now writes only when the patch touches a persisted key.

Left open as TASK-73: two file trees on screen share the `file-tree` pane id but each holds its own `useState`, so dragging one leaves the other stale until it remounts. A consequence of TASK-69 sharing the id, and it needs a subscriber list on `pane-size-store` rather than a patch.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The sidebar's filter, grouping, archived toggle and closed groups now live in `sidebar-store.ts` instead of `useTaskSidebar`'s `useState`, so they outlive the remount that `/` and `/t/$slug` force on every navigation. Read in the state initialiser, so the first paint is already the stored arrangement.

The decision the task left open: the three settings persist per device, the filter does not. It survives a navigation — that is the whole defect — but is omitted from the persisted type, so a reload cannot open the app showing two of thirty tasks with the only explanation sitting in a text box.

It was four pieces of state rather than the three named: `closedGroups` resets the same way, and is what AC5 is about. A stale group id needs no pruning — the list is drawn from the groups that exist and the record is only ever read by id — and pruning against `projects` would be worse, since that list is empty on the first render and an eager prune would wipe every closed group on every cold load.

Verified by running the five remount tests against the pre-fix hook (all five fail, all five pass with it), and by driving the reported repro in Chrome: filter, click the row you found, and the box still holds it.
<!-- SECTION:FINAL_SUMMARY:END -->
