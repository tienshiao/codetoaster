---
id: TASK-81
title: New project asks for two fields; editing one asks for eight
status: Done
assignee: []
created_date: '2026-09-01 18:03'
updated_date: '2026-09-01 18:31'
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
- [x] #1 Creating a project offers every field editing one offers
- [x] #2 Both dialogs render one shared form component — no second copy of the Name/PathField/browse-mode block
- [x] #3 The createProject socket message and TaskManager.createProject take an optional settings patch and apply it in the same write as the identity columns
- [x] #4 A project created with settings broadcasts once, already carrying them
- [x] #5 Creating with no settings touched behaves exactly as before
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
`ProjectDialog.tsx` is the shared form — every field, the browse-mode body swap, the seeding, the `hasRepo` gating. `ProjectSettingsDialog` is now a ~50-line wrapper that supplies a title, a seed key and where Save goes; `NewProjectButton` shrank to a button plus the same dialog with `BLANK_PROJECT`.

Seeding is keyed on `open ? seedKey : null`. Edit passes the project's id, so reopening on a different row re-reads. Create passes the constant `"new"`, which is enough because the dialog closes in between and the key passes through null on the way — no nonce needed.

Wire: `createProject` grew an optional `settings` patch through `ClientMessage` → `client-messages.ts` → `TaskManager.createProject`, normalized by the same `normalizeSettingsPatch`/`settingsColumns` `updateProject` uses, and written in the same INSERT. `db.createProject` builds its column list from the caller's keys against an `INSERTABLE_PROJECT_COLUMNS` allowlist, the way `updateProject` already did — a column name reaches SQL as an identifier and cannot be bound.

One trap worth naming: TypeScript does **not** flag extra keys spread into an object literal, so widening `NewProject` was not optional bookkeeping — without it `tsc` stayed green while the settings were silently dropped between the manager and the INSERT.

Verified in Chrome against a real daemon: created "Verify" with model Fable, worktree on and `bun install`, then read the row straight out of SQLite — one INSERT already carrying `default_model='fable'`, `worktree_default=1`, `setup_command='bun install'`, with the untouched fields NULL rather than ''. Selecting the new project in the composer seeded model Fable, the worktree toggle and the base-ref field, which is the broadcast having carried the settings.

Three manager tests added (created-configured, blanks-as-NULL, no-settings-unchanged). 980 unit tests and 166 render tests pass; `tsc --noEmit` clean.

Also caught here: the dev bundle failed to resolve the new module until the daemon was restarted, so `tsc` and Vitest both stayed green while the app would not build. Worth remembering that neither runner uses Bun's resolver.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Creating a project now asks the same eight questions as editing one, out of a single `ProjectDialog`; `createProject` carries the settings over the socket and applies them in the same INSERT, so a new project is never broadcast half-configured. Verified in Chrome against a real daemon and by reading the created row out of SQLite.
<!-- SECTION:FINAL_SUMMARY:END -->
