---
id: TASK-55
title: 'Project settings: set default model and permission mode'
status: Done
assignee: []
created_date: '2026-08-30 20:53'
updated_date: '2026-08-31 03:29'
labels:
  - frontend
  - server
milestone: m-5
dependencies:
  - TASK-24
ordinal: 55000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
projects.default_model and projects.default_permission_mode have existed since TASK-1 and nothing can set them. TASK-24 made them real on the read side — they are on ProjectInfo, the composer seeds its model/mode selects from them, and createTask falls back to them when the caller sends no override — so the whole path works and simply resolves to null for every project. This task gives them a writer.

Deliberately not a new dialog. TASK-30 AC#5 already puts a project-settings surface in front of setup_command, worktree_copy, worktree_default and default_base_ref; these two belong in that same surface, and building a second one for two fields would be the mistake. If TASK-30 lands first this is two more fields in it; if this lands first it is the surface TASK-30 extends.

The option lists are already chosen and live in the composer (Composer.tsx): model is opus/sonnet/haiku, permission mode is default/acceptEdits/plan/bypassPermissions, each with an empty value meaning 'unset'. A project default of 'unset' must stay expressible, since that is what hands the choice back to Claude Code's own default.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A project's default model and default permission mode can be set and cleared from the project settings surface
- [x] #2 A task created with no explicit model or permission mode inherits the project's defaults; an explicit choice in the composer still wins
- [x] #3 Clearing a default returns the project to sending no flag at all, rather than storing an empty string
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done as part of TASK-30, which is what this task asked for: it said the fields belong in TASK-30 AC#5's project-settings surface rather than in a second dialog built for two fields, and TASK-30 landed first. `ProjectSettingsDialog` carries default model and permission mode beside the four worktree settings, both from the shared option lists in `lib/agent-options.ts` — extracted from `Composer.tsx` in that task so the composer and the settings form cannot drift. The empty choice is labelled 'Claude Code default' there and 'Project default' in the composer: the same empty string, one level apart. Clearing a field stores NULL rather than '', so a cleared default sends no flag at all (AC #3), which `worktree-create.test.ts` and `ProjectSettingsDialog.render.tsx` both pin.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Delivered by TASK-30. Default model and permission mode are set and cleared from the project settings surface that task built; clearing stores NULL, so the project returns to sending no flag. Inheritance was already working on the read side and is covered by `worktree-create.test.ts`.
<!-- SECTION:FINAL_SUMMARY:END -->
