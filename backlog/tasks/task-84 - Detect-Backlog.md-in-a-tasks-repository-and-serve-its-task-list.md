---
id: TASK-84
title: Detect Backlog.md in a task's repository and serve its task list
status: To Do
assignee: []
created_date: '2026-09-04 21:36'
labels:
  - server
  - api
  - backlog
dependencies: []
references:
  - src/api/files.ts
  - src/api/utils.ts
documentation:
  - docs/v2-architecture.md
ordinal: 84000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The first half of Backlog.md support in the v2 shell (the Explorer section is the second, the terminal links the third). A repository that carries a backlog/config.yml at its root is a Backlog.md project, and the shell wants to know that and what is in it: the Explorer grows a section for it and the terminals turn task ids into links, and both read from this route.

GET /api/tasks/:id/backlog, resolved from the task row the way the other data routes are (§5.4, resolveTaskRoot) so it answers for a task with no live process. Detection is the presence of backlog/config.yml under the task's repo_root; without it the route answers { detected: false } with a 200 and nothing else, so the client can simply not show the section. With it, the answer carries what the client needs and nothing it can derive: the id prefix as ids are actually written (config task_prefix is 'task', ids in files are 'TASK-82' — the client matches on the uppercased form and should be told it), the configured statuses in order, and one entry per task file in backlog/tasks/ and backlog/completed/: id, title, status, ordinal, priority, labels, assignee, and the path of the .md relative to the repository root (that path is what a card opens). Frontmatter is YAML and titles are routinely folded (title: >-), so parse it with Bun.YAML rather than by hand; a file whose frontmatter will not parse is skipped rather than failing the list. Order the entries as Backlog.md's board does: by ordinal ascending within a status, then by numeric id; the client groups by status and keeps this order. backlog/archive/ is not listed. Drafts are not listed.

The list changes under the shell constantly — the agent files and updates tasks through the CLI while it works — so it must be cheap enough to ask for again: read the files, no git, no CLI spawn.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 GET /api/tasks/:id/backlog answers { detected: false } for a repository with no backlog/config.yml and for a task with no repository, with status 200
- [ ] #2 For a Backlog.md repository it answers the id prefix, the statuses in configured order, and every task in backlog/tasks and backlog/completed with id, title, status, ordinal, priority, labels, assignee and repository-relative path, ordered by ordinal then numeric id
- [ ] #3 A folded (>-) multi-line title comes back as one line, and a task file whose frontmatter does not parse is skipped without failing the request
- [ ] #4 Tests cover detection, ordering, folded titles, the completed folder and the unparseable file
<!-- AC:END -->
