---
id: TASK-55
title: 'Project settings: set default model and permission mode'
status: To Do
assignee: []
created_date: '2026-08-30 20:53'
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
- [ ] #1 A project's default model and default permission mode can be set and cleared from the project settings surface
- [ ] #2 A task created with no explicit model or permission mode inherits the project's defaults; an explicit choice in the composer still wins
- [ ] #3 Clearing a default returns the project to sending no flag at all, rather than storing an empty string
<!-- AC:END -->
