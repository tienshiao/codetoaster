---
id: TASK-89
title: 'Configurable agent profiles: run a task on something other than claude'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-05 09:31'
updated_date: '2026-09-05 21:09'
labels:
  - server
  - frontend
  - agent
dependencies: []
references:
  - src/lib/agent/spawn.ts
  - src/lib/agent/settings.ts
  - src/lib/tasks/manager.ts
  - src/api/tasks.ts
  - src/frontend/components/Composer.tsx
  - test/fake-agent.sh
documentation:
  - docs/v2-architecture.md
priority: medium
ordinal: 89000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Every task runs claude. buildAgentCommand hard-codes the invocation (--session-id, --settings with our hooks, --resume, --continue, --model, --permission-mode, the prompt behind --), the only knob is the binary name via CODETOASTER_AGENT_BIN, and the CreateOptions.command override that tests use to stand in a plain shell is internal and deliberately not an API field (a raw argv over HTTP is what TASK-42 closed off).

The ask is to run a task on an alternate agent such as pi, chosen per project or per task, and to have a harmless 'no agent' profile for verification instead of spawning a real Claude Code session by accident.

Shape this as agent profiles rather than a free-form command: a profile has a name, an argv template for starting and one for resuming (placeholders for the prompt, the session id, the model, the cwd), and declares what it supports — a session id we assign up front, resume, our hook settings file, a permission mode. The built-in 'claude' profile is today's behaviour and stays the default; a 'shell' profile runs the user's shell with no prompt. Profiles come from the daemon's configuration (a file under ~/.codetoaster/, or flags), never from the HTTP body, so the API only ever names a profile. Projects get a default profile column and the composer offers the choice alongside model.

pi is the worked example and should ship as a built-in profile. Checked against pi --help (2026-09): 'pi --session-id <id>' uses an exact session id, creating it if missing — so the same template serves start and resume, and we keep choosing the id up front exactly as we do for claude. The prompt goes positionally behind '--', the model is '--model <provider/id>' (with an optional ':<thinking>' suffix), and '--continue' exists as the same directory-scoped fallback claude has. pi stores sessions per project directory (--session-dir overrides), which matches our worktree-per-task layout. It has no permission-mode flag, so that field is not passed. It has no hooks, but it does load extensions ('-e <path>'), which is a plausible later home for a state reporter; until then a pi task lives in TASK-12's degraded mode.

Be honest about what degrades. Hooks are a Claude Code feature: a profile without them lands in the degraded mode (output-activity heuristic for busy/idle). A profile that declares no resume cannot bring a conversation back, so reopening a suspended task restarts the command in the task's cwd and the task card says so. Model and permission-mode fields are passed only to profiles that declare them.

Split into subtasks if it grows: profile model and spawn templates; daemon configuration and the built-in profiles; project column, API field and composer control; resume and hook degradation with tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A profile registry with built-in 'claude' (today's exact argv, asserted by the existing spawn tests) and 'shell' profiles, loaded with user-defined profiles from daemon configuration and never from an HTTP body
- [ ] #2 POST /api/tasks and the composer accept a profile name; projects carry a default profile; an unknown name is a 400
- [ ] #3 A task on a profile without hooks shows busy/idle from the output heuristic, and one without resume support restarts its command on reopen with the card explaining why
- [ ] #4 CODETOASTER_AGENT_BIN keeps working as the claude profile's binary override, so the test preload is unchanged
- [ ] #5 A task created on the 'shell' profile spawns no agent, which the verify skill documents as the way to exercise the UI safely
- [ ] #6 A built-in 'pi' profile: --session-id <id> for both start and resume, --model when set, no permission mode, the prompt behind --, asserted by a spawn test; a task on it resumes on reopen the way a claude task does, minus hook-driven state
<!-- AC:END -->
