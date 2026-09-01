---
id: TASK-81
title: New project asks for two fields; editing one asks for eight
status: To Do
assignee: []
created_date: '2026-09-01 18:03'
labels:
  - frontend
  - ui
milestone: m-5
dependencies:
  - TASK-80
ordinal: 81000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`NewProjectButton` in `TaskSidebar.tsx` collects a name and a repository path. `ProjectSettingsDialog` collects those plus the default model, the worktree default, the base ref, the setup command and the files to copy into a worktree. So every project is created half-configured and has to be reopened to finish, and the two dialogs are already near-copies of each other — same Name field, same `PathField`, same swap-the-body directory browser, same seeding comment.

Give create the same form as edit, out of one component. The natural shape is a `ProjectForm` holding the fields and the browse mode, with the two dialogs supplying only their title, their confirm label and where the values go — which also stops the next project setting from having to be added twice.

The wire needs the settings too. `createProject` is a socket message carrying `{ id, name, initialPath }` and `TaskManager.createProject` writes the identity columns only, noting that defaults come later. Both grow the same optional `settings: Partial<ProjectSettings>` that `updateProject` already takes, applied in the same write so a created project never broadcasts twice or exists for a moment without its defaults.

Note the ordering with TASK-80: permission mode is coming out of project settings, so build the shared form after it, not before.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Creating a project offers every field editing one offers
- [ ] #2 Both dialogs render one shared form component — no second copy of the Name/PathField/browse-mode block
- [ ] #3 The createProject socket message and TaskManager.createProject take an optional settings patch and apply it in the same write as the identity columns
- [ ] #4 A project created with settings broadcasts once, already carrying them
- [ ] #5 Creating with no settings touched behaves exactly as before
<!-- AC:END -->
