---
id: TASK-80
title: >-
  Agent options: add Fable, capitalise the models, drop permission mode from the
  UI
status: Done
assignee: []
created_date: '2026-09-01 18:03'
updated_date: '2026-09-01 18:31'
labels:
  - frontend
  - ui
milestone: m-5
dependencies: []
ordinal: 80000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Three corrections to what the composer and project settings offer for a task's agent options.

**Fable is missing.** `MODEL_VALUES` in `src/frontend/lib/agent-options.ts` is `["opus", "sonnet", "haiku"]`, written before Fable existed. The value on the wire stays lowercase — it is what goes on `claude --model` — but the *label* should read as the model's name, so the list is Fable, Opus, Sonnet, Haiku, most capable first, and `optionsWithFallback` stops using the raw value as its own label.

**Permission mode leaves the UI entirely.** The composer's `mode` chip and project settings' "Default permission mode" both go, and with nothing setting it, `spawn.ts` puts no `--permission-mode` on the argv and Claude Code decides for itself — which is what it should have been doing. The `permission_mode` column, the create-task field and the server-side resolution in `manager.createTask` all stay: the HTTP API and the CLI still accept one, and a stored value still spawns with it. This removes the two controls, not the capability.

That leaves the composer's options row as project, model, worktree, and base ref.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Model options are labelled Fable, Opus, Sonnet, Haiku; the submitted values stay lowercase
- [x] #2 The composer has no mode Select and never sends permissionMode
- [x] #3 ProjectSettingsDialog has no Default permission mode field and no longer sends defaultPermissionMode
- [x] #4 The permission_mode column, the POST /api/tasks field and manager.createTask's resolution are untouched, with their tests still passing
- [x] #5 MODEL_OPTIONS lists fable, opus, sonnet, haiku in that order, each with an explicit label
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. agent-options.ts: add `fable` to MODEL_VALUES ordered fable/opus/sonnet/haiku; give options an explicit label rather than reusing the value. Leave PERMISSION_MODE_VALUES and its helpers in place only if something still uses them — otherwise delete them with the controls.
2. Composer.tsx: delete the mode Select, the `mode` state, its seeding, and `permissionMode` from the createTask payload.
3. ProjectSettingsDialog.tsx: delete the Default permission mode Field and `defaultPermissionMode` from the onSave patch.
4. Leave the column, the API field and manager.createTask's resolution alone; run the server tests to prove it.
5. Update Composer.render.tsx and ProjectSettingsDialog.render.tsx.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
`agent-options.ts` now exports `MODEL_OPTIONS` (value/label pairs, most capable first) and `modelOptions(fallbackLabel)`; `MODEL_VALUES`, `PERMISSION_MODE_VALUES` and `optionsWithFallback` are gone. A values tuple plus a label map would have been two lists to keep in step for no gain, since the value and the label genuinely differ.

Composer: the mode Select, its state, its seeding and `permissionMode:` in the payload all removed. ProjectSettingsDialog: the Default permission mode Field and `defaultPermissionMode` in the save patch removed.

Server untouched, and proved so — `permission_mode` still round-trips in `store.test.ts`, `manager.test.ts` still asserts the project-default resolution, `spawn.test.ts` still asserts the `--permission-mode` argv. 977 unit tests and 157 render tests pass; `tsc --noEmit` clean.

Two render tests added/reworked: the model select sends `fable`, and the composer never sends a permissionMode even when the project column holds one.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The model list gained Fable and reads as names rather than wire values; the permission-mode controls left the composer and project settings, so nothing in the UI puts --permission-mode on the agent's argv. The column, the API field and the server's resolution are untouched.
<!-- SECTION:FINAL_SUMMARY:END -->
