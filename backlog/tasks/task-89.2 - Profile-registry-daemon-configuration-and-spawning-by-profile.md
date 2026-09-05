---
id: TASK-89.2
title: 'Profile registry, daemon configuration, and spawning by profile'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-05 21:09'
updated_date: '2026-09-05 21:35'
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
- [x] #1 A profiles.json with a valid user profile is loaded at start, replaces a built-in of the same name, and an invalid one fails startup naming the profile and the problem
- [x] #2 tasks.agent_profile exists by migration, defaults to claude for existing rows, and round-trips through TaskRow and the task DTO
- [x] #3 createTask and spawnAgent render argv through the task's profile; a task on pi resumes with --session-id and a task on claude with --resume, asserted by an argv-recording stand-in
- [x] #4 No settings.json is written for a profile without hooks, and CODETOASTER_AGENT_BIN still points the claude profile at the test stand-in
- [x] #5 An unknown profile name to createTask throws an error the API layer can identify; tsc and bun run test clean
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. src/lib/agent/profiles.ts: ProfileRegistry (get, require throwing UnknownProfileError, list, DEFAULT_PROFILE = 'claude'), loadProfiles(filePath = ~/.codetoaster/profiles.json, env) merging validated user entries over the built-ins (missing file = built-ins only; bad JSON or an invalid profile throws naming the file and the profile). profiles.test.ts over temp files.
2. db.ts migration 008_tasks_agent_profile: tasks.agent_profile TEXT NOT NULL DEFAULT 'claude'; TaskRow, NewTask, the store's column lists, and TaskInfo.profile carry it. AgentTask is left alone so spawn.test.ts stays untouched; the manager passes the profile in options, plus a new options.cwd for the {cwd} placeholder.
3. manager.ts: a ProfileRegistry field defaulting to the built-ins with setProfiles(); CreateTaskOptions.profile resolved through require() before the worktree is created, stored on the row; settings written and passed only when the profile's capabilities say hooks; create and spawnAgent render through the row's profile. resumeLadder: for a profile other than claude the transcript-derived rungs do not apply — the ladder is resume-by-row-id if the profile can resume, then continue if it has one; an empty ladder falls through to could_not_resume (TASK-89.4 turns that into a restart).
4. server.ts loads the registry once at start, hands it to the manager, logs when user-defined profiles were loaded; a bad profiles.json fails startup with its message.
5. Tests: migration round trip; createTask on an argv-recording profile without hooks writes no settings.json and starts with --session-id; resume on it renders --session-id not --resume; claude unchanged; unknown name throws UnknownProfileError. tsc and bun run test clean.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Landed as planned. profiles.ts: ProfileRegistry (later entries replace earlier in place; userDefined names for the startup log), UnknownProfileError, loadProfiles over ~/.codetoaster/profiles.json (ENOENT = built-ins; any other read error, bad JSON, non-object document or entry, or validateProfile failure throws naming the file and profile; label defaults to the key). Migration 008 adds tasks.agent_profile NOT NULL DEFAULT 'claude'; TaskRow, NewTask, store columns and TaskInfo.profile carry it. Manager: profile resolved before the worktree so an unknown name undoes nothing; settings written only when capabilities.hooks, on create and on spawnAgent; resumeLadder is resume-by-row-id then continue for non-claude profiles, and claude's transcript rungs are additionally gated on the profile's own resume/continue capabilities so a user replacement lacking one cannot throw inside the ladder. Server loads the registry before loadProjects and fails startup on a bad file. Known edge for 89.4: a row whose profile was since removed from profiles.json throws UnknownProfileError out of resume. Validation: tsc clean; unit 1310 pass / 0 fail (+25); render 268 pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Profiles are loaded from ~/.codetoaster/profiles.json over the built-ins at daemon start and never from a request. Each task records its profile in a new agent_profile column, and both create and every resume rung render argv through it; the hooks settings file is written only for profiles whose templates take one. Non-claude profiles resume by stored id then continue, without the Claude-transcript rungs. Verified with registry, store and argv-recording spawn tests, tsc and the full suite.
<!-- SECTION:FINAL_SUMMARY:END -->
