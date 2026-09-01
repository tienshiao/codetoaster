---
id: TASK-77
title: A project group's + opens the composer with that project pre-selected
status: Done
assignee:
  - '@claude'
created_date: '2026-09-01 17:36'
updated_date: '2026-09-01 17:44'
labels:
  - frontend
dependencies:
  - TASK-76
ordinal: 77000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up to TASK-76. The composer's project select defaults to the first project in the list, so a user starting a task from inside a project group still has to pick the project again. Each project group header gets its own + (next to the settings/delete actions) that opens the composer at /?project=<id> with that project selected; the sidebar header's + keeps opening it with no preference. The composer honours the search param on mount and also when it changes while / is already showing, without discarding a prompt already typed. An unknown project id falls back to the existing first-project behaviour.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Clicking + in a project group header navigates to /?project=<id> and the composer shows that project selected, with model/mode seeded from it
- [x] #2 Clicking a different group's + while already on / moves the selection and keeps the typed prompt
- [x] #3 The sidebar header's + still opens the composer with no project preference
- [x] #4 An unknown or absent project param leaves the composer on its default selection
- [x] #5 Rendering tests cover the composer's pre-selection and the hook's navigation; docs §7.5 mentions the per-project entry
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. routes/index.tsx: validateSearch { project?: string }; HomeRoute passes it to <Composer projectId>. 2. Composer: projectId prop; initial state and a render-time adjust when the prop changes (prompt untouched). 3. useOpenComposer takes { projectId? } and navigates with search. 4. TaskSidebarOptions.onNewTask takes { projectId? }; header + calls it bare; ProjectActions gets a Plus IconButton 'New task in <name>' calling it with the group id. 5. Tests in Composer.render, use-task-nav.render, TaskSidebar-state.render; docs.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
The project rides on the URL as /?project=<id> (validateSearch on routes/index.tsx, string-or-absent only) and reaches Composer as a prop; Composer adjusts its selection at render time when the prop changes, tracked by what was last requested rather than what is selected, so a hand-made choice is not undone on rerender and the typed prompt is never touched. An unknown id falls through the existing ?? projects[0] fallback with no extra code. routeTree.gen.ts needed no regeneration (tsr generate produced no diff). The sidebar hook wraps the header's callback bare so AppShell's MouseEvent does not land in the options slot. Validation: tsc clean; vitest 19 files / 156 tests pass; bun test 977 pass, 0 fail.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Each project group header has its own + that opens the composer at /?project=<id> with that project selected (model/mode re-seeded from it); the top-level + still opens it with no preference. Composer takes projectId as a prop and honours changes to it while mounted without dropping the prompt. Tests cover pre-selection, live re-selection, unknown ids, the hook's navigation and both sidebar buttons; docs §7.5 updated.
<!-- SECTION:FINAL_SUMMARY:END -->
