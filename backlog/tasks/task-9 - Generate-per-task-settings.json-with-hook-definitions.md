---
id: TASK-9
title: Generate per-task settings.json with hook definitions
status: Done
assignee:
  - '@claude'
created_date: '2026-08-29 00:02'
updated_date: '2026-08-29 04:59'
labels:
  - server
  - agent
milestone: m-1
dependencies:
  - TASK-8
documentation:
  - docs/v2-architecture.md
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Write ~/.codetoaster/tasks/<task-id>/settings.json containing hook entries for SessionStart, UserPromptSubmit, Stop, Notification, SessionEnd, PreCompact — all pointing at the single command `codetoaster hook` (§4.2). The task id and port travel in the env, so the file is identical for every task apart from its path. Verified in Phase 0: --settings merges with the user's own hooks rather than shadowing them.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 settings.json is written before spawn and passed via --settings
- [x] #2 Every hook event in the §4.2 table is registered with the `codetoaster hook` command
- [x] #3 The directory ~/.codetoaster/tasks/<id>/ is created on demand
- [x] #4 A test asserts the generated JSON shape
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. src/lib/agent/settings.ts: buildSettings(hookCommand) returns the settings object — one entry per §4.2 event (SessionStart, UserPromptSubmit, Stop, Notification, SessionEnd, PreCompact), each an array of one matcher group with no matcher (every occurrence fires) whose hooks array holds { type: 'command', command, timeout }. Short timeout, so a wedged reporter cannot stall the agent's path.
2. hookCommand() derives the command line from the running daemon, since 'codetoaster' is not on PATH in dev. Compiled binary -> process.execPath + ' hook'; bun + script -> execPath + Bun.main + ' hook'. Detected by the bunfs marker in Bun.main: probed a real --compile binary, where Bun.main is /$bunfs/root/<name> and fs.existsSync(Bun.main) is TRUE, so an existence check would have been wrong. Shell-quote each path — settings 'command' is one string run through a shell.
3. writeTaskSettings(taskId) mkdirs taskDir and writes the file; rewritten on every spawn rather than once, so a moved binary or an upgraded daemon refreshes the command instead of leaving a stale path behind.
4. TaskManager.createTask writes the settings before it spawns and passes settingsPath to buildAgentCommand, which turns on the --settings flag TASK-8 deliberately left off.
5. Tests: the JSON shape (all six events, command present, no matcher), hookCommand in both modes including a path with spaces, the directory created on demand, and the file existing with --settings in argv after createTask.
6. Then /code-review --fix and /verify.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
lib/agent/settings.ts holds buildSettings (all six §4.2 events, one matcher group each with no matcher so nothing is filtered out — SessionStart has to fire on resume and clear, not just startup — and a 5s timeout as the outer guard on the agent's path), hookCommand/hookCommandFrom, and writeTaskSettings.

hookCommand derives the command line from the running daemon rather than hardcoding 'codetoaster hook', since dev has no codetoaster on PATH. Compiled binary runs itself; a script runs under the runtime in front of it. Detection is by the /$bunfs/ marker in Bun.main, NOT by whether that path exists: probed against a real bun build --compile binary, where Bun.main is /$bunfs/root/<name> and fs.existsSync on it returns true, because the embedded filesystem is mounted for the process. An existence check reads exactly backwards. Each path is shell-quoted, since 'command' is one string handed to a shell.

Settings are written before the spawn (the agent reads the file at startup) and rewritten on every start, so a daemon that moved does not leave a task pointing at a command line that no longer resolves. Bun.write creates the parent directories, which is the whole of 'created on demand'. A caller that brings its own command gets no settings — a plain shell has no hooks.

Code review (--fix) also fixed two things: a failed writeTaskSettings left the directory behind (Bun.write creates it before writing), now symmetric with the failed-spawn path; and, outside this task's scope, refreshCwd never re-resolved a null repo_root while the cwd stayed put, so a task created while git was momentarily wedged — or one where the user ran git init later — answered 400 'Not a git repository' from its Changes/Files/History tabs for life.

Runtime verification (daemon on :4599): argv came out as 'claude --session-id <uuid> --settings /Users/tma/.codetoaster/tasks/<task-id>/settings.json'; the agent loaded the file and FIRED the hook on startup — the terminal shows 'SessionStart:startup hook error / Failed with non-blocking status code: Unknown command: hook'. That is the registration working end to end, with only the reporter missing: 'codetoaster hook' is TASK-10. Non-blocking, as §4.2 requires.
bun test 309 pass / 0 fail; bunx tsc --noEmit clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Per-task settings.json now carries the hook definitions the agent control plane runs on. lib/agent/settings.ts builds the file (six events, no matchers, one command, short timeout), derives that command from the running daemon — compiled binary or bun+script, detected by Bun.main's $bunfs marker rather than a file-existence check that reads backwards inside a compiled binary — and writes it before every spawn, which turns on the --settings flag TASK-8 left off. Verified live: the spawned agent loaded the file and fired SessionStart, failing only on the reporter subcommand TASK-10 adds.
<!-- SECTION:FINAL_SUMMARY:END -->
