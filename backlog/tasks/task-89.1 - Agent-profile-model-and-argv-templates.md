---
id: TASK-89.1
title: Agent profile model and argv templates
status: Done
assignee:
  - '@claude'
created_date: '2026-09-05 21:08'
updated_date: '2026-09-05 21:19'
labels:
  - backend
  - agent
dependencies: []
parent_task_id: TASK-89
ordinal: 91000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The pure half of TASK-89: a profile type and a renderer that turns one plus a task row into an argv, so buildAgentCommand stops hard-coding the claude invocation. No database, no filesystem, no spawn — the same discipline spawn.ts has now.

A profile is { name, label, bin, binEnv?, start, resume?, continue? }. bin is the binary; binEnv names an environment variable that overrides it (the built-in claude profile sets CODETOASTER_AGENT_BIN, which is how the test preload and a user with claude off the daemon's PATH keep working). start, resume and continue are argv templates (arrays of tokens after the binary). A token that is exactly a placeholder — {session_id}, {prompt}, {model}, {permission_mode}, {settings}, {cwd} — is substituted; when its value is unset the token is dropped, and so is the flag token immediately before it if that token starts with a dash, so '--model {model}' vanishes as a pair and '-- {prompt}' does too. A missing resume template means the profile cannot bring a conversation back; a missing continue template means it has no directory-scoped fallback rung.

What a profile supports is derived from its templates rather than declared alongside them, so the two cannot disagree: profileCapabilities(profile) reports sessionId (start mentions {session_id}), resume (a resume template exists), continue, hooks ({settings} appears), model, permissionMode and prompt.

Built-ins, as data in the same module: claude — today's exact argv (session id on start, --resume on resume, --continue, --settings, --model, --permission-mode, prompt behind --, prompt only on start); shell — bin from $SHELL with /bin/sh as the fallback, an empty start template, no resume or continue, nothing else; pi — --session-id {session_id} for both start and resume, --continue, --model {model}, no permission mode, no settings, prompt behind --. All three are validated by the same rules a user-defined profile will be: a name, a bin, a start template, placeholders only from the known set, {session_id} in resume implies {session_id} in start.

buildAgentCommand keeps its signature and gains an optional profile in its options, defaulting to the claude profile, so the existing spawn tests hold unchanged and stand as the assertion that the claude profile is today's argv.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 buildAgentCommand with no profile produces exactly the argv it does today for start, resume and continue, and the existing spawn.test.ts passes unchanged
- [x] #2 The claude profile's binary is overridden by CODETOASTER_AGENT_BIN, and agent-bin.test.ts passes unchanged
- [x] #3 The shell profile renders to the user's shell alone: no session id, no prompt, no flags, whatever the row carries
- [x] #4 The pi profile renders --session-id <id> for both start and resume, --model only when the row has one, no --permission-mode and no --settings, and the prompt behind -- on start only
- [x] #5 An unset placeholder drops its token and the dash-prefixed flag before it; a set one is substituted verbatim, including a prompt with newlines, quotes and a leading dash
- [x] #6 profileCapabilities is derived from the templates and reports resume false for shell, hooks false for pi and shell, permissionMode true only for claude
- [x] #7 validateProfile rejects an unknown placeholder, a missing bin or start, and a resume template naming {session_id} when start does not, each with a message naming the profile and the problem
- [x] #8 Unit tests in profile.test.ts cover the renderer, the capabilities, the validation and all three built-ins; tsc and bun run test clean
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. src/lib/agent/profile.ts: AgentProfile type, PLACEHOLDERS, renderTemplate (substitute set placeholders, drop an unset one with the dash-prefixed flag before it), profileCapabilities (derived from the templates), validateProfile (name, bin, start, known placeholders, resume's {session_id} implies start's), resolveBin (binEnv over bin), and builtinProfiles(env) returning claude, shell and pi as data.
2. spawn.ts: buildAgentCommand keeps its signature; options.profile defaults to the claude built-in; the session-id guard becomes 'the template names {session_id} and none was given'; the body is one call to the renderer. AgentTask unchanged.
3. profile.test.ts: renderer edge cases, capabilities per built-in, validation messages, and the three built-ins' argv for start, resume and continue. spawn.test.ts and agent-bin.test.ts pass unchanged.
4. tsc and bun run test clean.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Landed as planned. profile.ts: AgentProfile with start/resume/continue templates, renderTemplate (unset placeholder drops its token and the dash-prefixed literal before it; a substituted value is never popped; after a pop the tail is treated as a value so a run of unset placeholders unwinds one flag each), profileCapabilities derived from the templates, validateProfile (also rejects any embedded {..} group, not only --model={model}), resolveBin, builtinProfiles(env) for claude, shell ($SHELL or /bin/sh) and pi, claudeProfile(). spawn.ts renders through the profile; the session-id guard is conditioned on the template naming {session_id}; a missing template throws 'profile "shell" cannot resume'. spawn.test.ts and agent-bin.test.ts untouched. Validation: tsc clean; unit 1285 pass / 0 fail (+41 in profile.test.ts); render 268 pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Agent profiles as data: a binary plus argv templates for start, resume and continue with placeholder tokens, capabilities derived from the templates, validation, and built-in claude, shell and pi profiles. buildAgentCommand renders through the claude profile by default so its existing argv tests pin today's behaviour unchanged. Verified with 41 new unit tests, tsc and the full suite.
<!-- SECTION:FINAL_SUMMARY:END -->
