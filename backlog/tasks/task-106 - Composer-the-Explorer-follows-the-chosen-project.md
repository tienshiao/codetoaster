---
id: TASK-106
title: 'Composer: the Explorer follows the chosen project'
status: To Do
assignee: []
created_date: '2026-09-16 22:50'
labels:
  - frontend
  - composer
  - explorer
dependencies: []
references:
  - src/frontend/components/Explorer.tsx
  - src/frontend/routes/index.tsx
  - src/frontend/components/Composer.tsx
  - src/api/files.ts
ordinal: 108000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On the composer screen (/, TaskShell taskId={null}) the right-hand Explorer shows only 'Pick a task to see its files.', so while writing a prompt the user cannot look at the files, backlog, commits or refs of the project they are about to start an agent in. Once a project is chosen in the composer, the Explorer should show that project's repository: Files, Backlog, History and Refs (Changes too if the checkout has uncommitted work), and it should switch when the project selection changes. Today every section is keyed by taskId and reads task-scoped routes (/api/tasks/:id/files, /backlog, /git/log, /git/refs, /diff, /file); only /api/projects/:id/files/search exists on the project side (used by the composer's @ picker, TASK-100). So this needs either project-scoped equivalents of those routes or a shared root abstraction the Explorer can be keyed by (task or project), resolving to the project's path, which is the checkout a non-worktree task would use. Decide before building: where a clicked file, backlog card or commit opens when there is no task and so no tab strip, e.g. a preview in the main area beside the composer, without losing the prompt being typed. A backlog card or file could also offer to insert its path into the prompt as an @ mention.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 With a project chosen in the composer, the Explorer shows that project's Files, Backlog (when detected), History and Refs instead of the 'Pick a task' placeholder
- [ ] #2 Changing the project in the composer switches the Explorer to the new project; with no project chosen the placeholder remains
- [ ] #3 Opening a file, backlog task or commit from the Explorer on the composer screen shows it without navigating away or discarding the prompt, attachments or options in the composer
- [ ] #4 Task screens behave exactly as before; the Explorer's per-task state is not mixed with the project-scoped state
- [ ] #5 Project-scoped API routes (or the shared root) have route tests, and the Explorer's project mode has a rendering test
<!-- AC:END -->
