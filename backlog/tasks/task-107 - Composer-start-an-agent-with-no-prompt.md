---
id: TASK-107
title: 'Composer: start an agent with no prompt'
status: Done
assignee:
  - '@tma'
created_date: '2026-09-16 22:50'
updated_date: '2026-09-16 23:06'
labels:
  - frontend
  - composer
dependencies: []
references:
  - src/frontend/components/Composer.tsx
  - src/api/tasks.test.ts
ordinal: 109000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The composer's Start button and Cmd+Enter are disabled until something is typed or attached (canSubmit in Composer.tsx requires prompt.trim() or attachments). Sometimes the user wants to pick the project, profile, model and worktree options in the composer and then talk to the agent interactively in its terminal, with no initial prompt. The server already allows this: POST /api/tasks with no prompt creates a task with initial_prompt '' (see the 'a task with no prompt at all is allowed' test), which is how the old New task button worked. The composer should allow submitting with an empty prompt, sending no prompt field rather than a blank one, while keeping all its other options. A whitespace-only prompt counts as empty. The task title falls back to whatever the server uses for a promptless task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 With a project chosen and an empty prompt and no attachments, Start is enabled and Cmd+Enter starts the task
- [x] #2 The created task uses the composer's chosen project, profile, model and worktree options, and its agent starts with no initial prompt
- [x] #3 A whitespace-only prompt is treated as no prompt, and the request omits the prompt field rather than sending a blank string
- [x] #4 Submitting stays disabled while a submit is in flight and when no project is chosen
- [x] #5 Composer rendering tests cover the promptless start
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Composer.tsx: canSubmit requires a project and no submit in flight, not a prompt; the request sends prompt only when the built prompt is non-empty (the server 400s on a blank one). 2. Composer.render.tsx: replace the whitespace-only-is-not-a-task test with promptless start (button and Cmd+Enter), whitespace-only omits the field, disabled with no project and while submitting.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Server side needed nothing: POST /api/tasks already treats an absent prompt as a promptless task and 400s a blank one, so the composer sends prompt only when the built text is non-empty. canSubmit now requires a project (absent only before the list lands) instead of text or attachments. Validation: bun run test green (1554 unit, 358 render); tsc clean; in Chrome on an isolated server with the fake agent, Cmd+Enter in an empty composer created the task with initial_prompt empty and opened its Agent tab.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The composer starts a task with no prompt: Start and Cmd+Enter are enabled whenever a project is chosen, and an empty or whitespace-only prompt is omitted from the request rather than sent blank. Covered by Composer rendering tests and checked in the browser.
<!-- SECTION:FINAL_SUMMARY:END -->
