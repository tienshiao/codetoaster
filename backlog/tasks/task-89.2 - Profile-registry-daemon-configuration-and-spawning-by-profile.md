---
id: TASK-89.2
title: 'Profile registry, daemon configuration, and spawning by profile'
status: To Do
assignee: []
created_date: '2026-09-05 21:09'
labels:
  - backend
  - agent
dependencies:
  - TASK-89.1
parent_task_id: TASK-89
ordinal: 92000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The registry and the wiring. A ProfileRegistry holds the built-ins from TASK-89.1 plus user-defined profiles read from ~/.codetoaster/profiles.json (an object keyed by name, each value the profile shape minus name; a user entry named like a built-in replaces it). Loaded once at daemon start and validated with validateProfile; a bad file is a clear error at startup, not a 500 on the first task. Profiles never arrive in an HTTP body — the API only ever names one.

The tasks table gains agent_profile TEXT NOT NULL DEFAULT 'claude' so a suspended task remembers what it runs on; TaskRow, AgentTask and the task DTO carry it. createTask takes an optional profile name (unknown is an error the route can turn into a 400), stores it, and both the create path and spawnAgent render the command through the profile. writeTaskSettings runs only for a profile whose capabilities say hooks, and the settings flag is what carries the path. The existing CreateOptions.command override stays for the tests that use it.

Server start wires the registry into the manager the way the harvester options are wired: constructed once, passed in, logged if user-defined profiles were loaded.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A profiles.json with a valid user profile is loaded at start, replaces a built-in of the same name, and an invalid one fails startup naming the profile and the problem
- [ ] #2 tasks.agent_profile exists by migration, defaults to claude for existing rows, and round-trips through TaskRow and the task DTO
- [ ] #3 createTask and spawnAgent render argv through the task's profile; a task on pi resumes with --session-id and a task on claude with --resume, asserted by an argv-recording stand-in
- [ ] #4 No settings.json is written for a profile without hooks, and CODETOASTER_AGENT_BIN still points the claude profile at the test stand-in
- [ ] #5 An unknown profile name to createTask throws an error the API layer can identify; tsc and bun run test clean
<!-- AC:END -->
