---
id: TASK-89.3
title: 'Profile choice: project default, API field, composer control'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-05 21:09'
updated_date: '2026-09-05 22:11'
labels:
  - frontend
  - backend
  - agent
dependencies:
  - TASK-89.2
parent_task_id: TASK-89
ordinal: 93000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Letting a user pick. projects gain default_profile TEXT NULL (unset means claude), exposed through the project DTO and PATCH like default_model. POST /api/tasks accepts profile as an optional string, resolved the same way model is: the request's value, else the project's default, else claude; an unknown name is a 400 naming it. GET /api/profiles lists the registry — name, label and capabilities — so the client renders what the daemon actually has rather than a hard-coded list. The composer gets a profile Select beside model (options from /api/profiles, 'Project default' as the unset value, the same knownValue pattern), and the project settings dialog gets the matching default. The task header or card shows the profile name when it is not claude.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 POST /api/tasks with an unknown profile is a 400 that names it; with a known one the row carries it
- [x] #2 GET /api/profiles lists the built-ins and any user-defined profile with their capabilities
- [x] #3 The composer offers the registry's profiles with Project default as the unset choice, and sends the field only when overridden; render test covers the control
- [x] #4 Project settings offers the same list for the default; tsc and bun run test clean
- [x] #5 The updateProject and createProject messages accept settings.defaultProfile (null clears it, an unknown name is refused and not stored), the project DTO carries it, and it is what a new task in that project inherits when the request names none
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. db.ts migration 009_projects_default_profile (projects.default_profile TEXT, NULL = claude); ProjectRow, ProjectSettings.defaultProfile, UNSET_PROJECT_SETTINGS, projectSettingsOf, normalizeSettingsPatch, settingsColumns, db.updateProject/createProject column lists. createProject and updateProject refuse a name the registry does not hold, through the handler's existing error path.
2. createTask resolves options.profile ?? project.defaultProfile ?? claude off the project the task joins, like model.
3. api/profiles.ts: GET /api/profiles listing name, label and capabilities from the manager's registry (a listProfiles() accessor), mounted beside taskRoutes. POST /api/tasks takes profile as an optional string and turns UnknownProfileError into a 400 naming it. API tests for both.
4. Frontend: hooks/use-profiles.ts (useQuery, staleTime Infinity); agent-options.ts profileOptions(profiles, fallbackLabel); Composer gets an 'agent' Select seeded from the project's default via knownValue, sends profile only when overridden, and disables the model Select when the effective profile takes no model; ProjectDialog/ProjectSettingsDialog get a matching default field; TaskContext.CreateTaskOptions.profile; the task header shows the profile's label when it is not claude.
5. Render tests: composer seeding and wire shape with a QueryClientProvider and a stubbed fetch, following the existing render tests that wrap one; project settings default round trip. tsc and bun run test clean.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Landed. Migration 009 adds projects.default_profile; ProjectSettings.defaultProfile flows through the DTO, the normalizer and the columns, and createProject/updateProject refuse an unknown name via checkDefaultProfile (updateProject's socket handler now shares createProject's try/catch → error frame). createTask resolves options.profile ?? project.defaultProfile ?? claude. GET /api/profiles lists name, label and capabilities; POST /api/tasks turns UnknownProfileError into a 400. Frontend: useProfiles, profileOptions, an 'agent' Select before model in the composer (value derived as touched ?? knownValue(project default) since the option list arrives after first render), model Select disabled with a title when the effective profile takes no model, a 'default agent' field in the project dialog labelled 'Default (Claude Code)' for unset, and an accent Badge with the profile label in the task status bar when it is not claude. Found and fixed a real Select bug: inside a form Radix's hidden native select dispatches a change reporting '' on a programmatic value change while the popup is closed, so a fetched option list silently reverted the value a frame later; Select now drops a raw '' from onValueChange, with a regression test. Validation: tsc clean; unit 1320 pass / 0 fail (+10); render 279 pass (+11).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A user can choose the agent per task and per project: the composer's agent Select and the project dialog's default agent both list the daemon's registry from GET /api/profiles, POST /api/tasks accepts a profile name and 400s an unknown one, project settings refuse an unknown default, and a non-claude task shows its profile in the status bar. Along the way a Radix Select bug that reverted values set after a fetched option list arrived was fixed with a regression test. Verified with API, manager, socket and render tests, tsc and the full suite.
<!-- SECTION:FINAL_SUMMARY:END -->
