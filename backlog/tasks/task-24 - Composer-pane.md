---
id: TASK-24
title: Composer pane
status: Done
assignee:
  - '@claude'
created_date: '2026-08-29 00:03'
updated_date: '2026-08-30 21:08'
labels:
  - frontend
milestone: m-3
dependencies:
  - TASK-20
  - TASK-21
documentation:
  - docs/v2-architecture.md
ordinal: 24000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
frontend/Composer.tsx (§7.5): rendered at / inside the app shell (task list left, Explorer right stay mounted). Prompt textarea (⌘⏎ submits), project selector over existing projects with initialPath, options row (model, permission mode; worktree toggle + base ref arrive in Phase 5). Submit → POST /api/tasks → navigate to /t/<slug> with the agent tab focused. No recent-tasks list — the sidebar is the history.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ⌘⏎ submits; an empty prompt cannot be submitted
- [x] #2 Project selector lists projects and honours project defaults for model/permission mode
- [x] #3 Successful submit navigates to the new task with the agent tab active
- [x] #4 Server errors from POST /api/tasks are shown inline, and the prompt is not lost
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Ported, not designed: the v2 Design System already carries components/task/TaskComposer plus core/Select and core/Textarea, none of which had been brought across. This task ports them and wires them up.

1. Wire the dead columns. projects.default_model / default_permission_mode were added by TASK-1 and are read and written by NOTHING, and are absent from ProjectInfo, so AC#2 could not be satisfied as the code stood. ProjectInfo gains defaultModel/defaultPermissionMode, loadProjects projects them, and createTask resolves model = options.model ?? project.default_model ?? null (same for permission mode). Nothing sets the columns yet, so the visible state is 'Project default' — the path is real and lights up when a settings UI lands. Follow-up task filed for that editor.
2. Port two v2 primitives from the design system: Textarea and Select. The design's Select is a presentational button; the port is a real native <select> wearing that chrome, so keyboard and mobile pickers work and TASK-33 has nothing to undo.
3. components/Composer.tsx: prompt textarea (⌘⏎ submits, empty prompt cannot), project select, model select, permission-mode select, KeyHint + Start task. No worktree toggle or base ref — the design includes them, TASK-24 defers them to Phase 5. No recent-tasks list (§7.5: the sidebar is the history).
4. routes/index.tsx renders it in place of NoTaskPlaceholder, inside TaskShell with taskId null.
5. Submit -> createTask -> on ok openTask(id, { tab: 'agent' }) so AC#3 holds by construction rather than by relying on createLayout's default. On failure the error renders inline and the prompt is untouched.
6. Permission modes: all four including bypassPermissions (user's call). Models: Project default / opus / sonnet / haiku.
7. Tests: Composer.render.tsx for the four ACs; a unit test for the server-side project-default fallback.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Build against `frontend/components/v2/` — the v2 design system is the new UI, not a parallel track (CLAUDE.md, "The v2 design system is the new UI"). `AppShell` and the shell components already exist from TASK-46; this task supplies their data. Do not extend `components/ui/` (v1 shadcn) for new surfaces.

Ported rather than designed. The v2 Design System already carried components/task/TaskComposer plus core/Select and core/Textarea; none had been brought across, so this was a port with two decisions on top.

AC#2 could not be satisfied as the code stood. projects.default_model and default_permission_mode were added by TASK-1 and read and written by NOTHING — and absent from ProjectInfo, so the client could not see them either. They are now on the wire, loadProjects projects them, the composer seeds its selects from the selected project, and createTask resolves model = options.model ?? project.defaultModel ?? null per field. Nothing writes the columns yet (TASK-55), so every project reads 'Project default' until it does.

The design's Select is a presentational button over a separate DropdownMenu. Ported as a native <select> wearing that chrome instead: typeahead, arrow keys, the platform picker on a phone and the whole accessibility tree come with the element and none would have survived reimplementation. The design's 'focused' prop on Textarea is a mock affordance for a static card and became a real focus: variant.

Worktree toggle and base-ref select omitted with a comment naming Phase 5 (TASK-30), per this task's own description.

A bug found in browser/API verification, not by the tests: the project-default fallback keyed off options.projectId, the project the CALLER NAMED, rather than the project the task actually joins. A create with no projectId still lands in 'general' via resolveProjectId — so POST /api/tasks {prompt}, the API and CLI shape and the very reason for resolving server-side, inherited nothing while its row sat in a project with defaults set. The existing unit test passed projectId explicitly every time, which is exactly why it missed it. Now resolved against resolveProjectId's answer, with a regression test confirmed to fail against the old code and only that test.

Verified in Chrome against an isolated daemon (own port, own db, stand-in agent binary so no real agent ran): whitespace-only prompt with the button disabled and ⌘⏎ inert, creating nothing; a real prompt enabling the button and ⌘⏎ navigating to /t/<slug> with the Agent tab active and the agent's argv carrying --model opus and the prompt; a create failed by stopping the daemon showing 'Failed to fetch' inline with the prompt untouched and the button re-enabled; and, with default_model/default_permission_mode written straight onto the general row, the composer seeding 'sonnet'/'plan' and a projectId-less POST inheriting both while an explicit --model haiku still won per field. No console errors.

tsc clean, 687 unit tests, 62 render tests.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The composer pane at /, ported from the v2 Design System's own components/task/TaskComposer: prompt textarea with ⌘⏎ (and Ctrl+⏎) to submit, an options row of project/model/mode, and Start task — rendered inside TaskShell so both sidebars stay mounted and starting a task and resuming one are the same gesture in the same place. No recent-tasks list; the sidebar is the history. Two v2 primitives came with it, Textarea and Select, the latter as a native <select> wearing the design's chip chrome so keyboard and mobile pickers work.

AC#2 needed a server change to mean anything: projects.default_model and default_permission_mode had existed unread and unwritten since TASK-1 and were not even on the wire. They are now on ProjectInfo, the composer seeds from them, and createTask resolves each field as caller ?? project ?? null. TASK-55 covers giving them a writer.

Browser and API verification caught a bug the tests did not: the fallback keyed off the project the caller named rather than the one the task joins, so a create with no projectId — the API and CLI shape, and the whole reason to resolve server-side — inherited nothing while its row sat in 'general'. Fixed against resolveProjectId, with a regression test that fails against the old code.

All four ACs verified in Chrome against an isolated daemon with a stand-in agent binary. tsc clean, 687 unit and 62 render tests.
<!-- SECTION:FINAL_SUMMARY:END -->
