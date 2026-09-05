---
id: TASK-89.3
title: 'Profile choice: project default, API field, composer control'
status: To Do
assignee: []
created_date: '2026-09-05 21:09'
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
- [ ] #1 PATCH /api/projects/:id accepts defaultProfile and the value is what a new task in that project inherits when the request names none
- [ ] #2 POST /api/tasks with an unknown profile is a 400 that names it; with a known one the row carries it
- [ ] #3 GET /api/profiles lists the built-ins and any user-defined profile with their capabilities
- [ ] #4 The composer offers the registry's profiles with Project default as the unset choice, and sends the field only when overridden; render test covers the control
- [ ] #5 Project settings offers the same list for the default; tsc and bun run test clean
<!-- AC:END -->
