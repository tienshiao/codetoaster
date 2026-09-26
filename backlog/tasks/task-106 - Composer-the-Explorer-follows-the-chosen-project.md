---
id: TASK-106
title: 'Composer: the Explorer follows the chosen project'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-16 22:50'
updated_date: '2026-09-26 08:18'
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
- [x] #1 With a project chosen in the composer, the Explorer shows that project's Files, Backlog (when detected), History and Refs instead of the 'Pick a task' placeholder
- [x] #2 Changing the project in the composer switches the Explorer to the new project; with no project chosen the placeholder remains
- [x] #3 Opening a file, backlog task or commit from the Explorer on the composer screen shows it without navigating away or discarding the prompt, attachments or options in the composer
- [x] #4 Task screens behave exactly as before; the Explorer's per-task state is not mixed with the project-scoped state
- [x] #5 Project-scoped API routes (or the shared root) have route tests, and the Explorer's project mode has a rendering test
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Server: shared root resolver in api/utils.ts (resolveProjectRoot: 404 unknown, 400 no directory / missing / not a repo; toplevel via rev-parse, short TTL cache) plus a rootRoutes(path, handlers) helper that registers each handler at /api/tasks/:id/<path> and /api/projects/:id/<path>; convert files, diff, backlog, git, highlight, symbols routes; fold the bespoke project files/search route into it (project scope searches from cwd); route tests. 2. Frontend: RepoRoot ({kind: task|project, id}) in repo-root.ts with rootApi/rootId; every repo-reading hook and read-only component takes a root instead of a taskId (query keys and view-state slots keyed by rootId, so task state stays under the task id and project state under project:<id>); terminals and link providers stay task-only. 3. Explorer takes root|null; rail for a project root shows Files/History/Refs, Backlog when detected, Changes only when the diff is non-empty. 4. Composer screen is a real tab area: TaskShell keys the layout by rootId(root), so a project gets a per-project layout whose Agent tab renders the composer (TabPane agentContent) and Explorer opens land as ordinary preview/pinned/split tabs; switching project swaps layouts; Start task moves the project layout to the new task; Review all appends the review to the prompt; deleted projects' layouts and view states are pruned with the tasks'. 5. Tests: project-root route tests, Explorer project-mode render test, TaskShell composer-layout render test, layout-store adopt/retain tests; then verify in a browser against an isolated server and run code review.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design decisions: (1) shared root abstraction on both sides rather than duplicated routes: server rootRoutes(path, handlers) registers one handler under /api/tasks/:id and /api/projects/:id, resolving the project root from initialPath via rev-parse; frontend RepoRoot {kind: task|project, id} replaces taskId in every repo-reading hook and read-only component, keyed by rootId (task id, or project:<id>) so task and project state never share a cache entry or a view-state slot. (2) An open from the Explorer on the composer screen sets a per-project preview (composer-preview-store), rendered by TabPane above the composer with a closable tab in the strip; the prompt, attachments and options live in the draft store and are never unmounted. (3) Review all on the composer appends the review to the prompt instead of sending to an agent.

Design change mid-task (user): the preview-slot approach (ComposerMain + composer-preview-store) was replaced by making the composer screen a real tab area. TaskShell keys useTaskLayout by rootId(root), so a project gets its own persisted layout (codetoaster:layout:project:<id>) whose Agent tab renders the composer (TabPane agentContent, labelled New task via TabArea's presentTab override); Explorer opens are ordinary preview/pinned/split tabs; switching the project chip swaps layouts; Composer's submit calls moveLayout(project root -> new task id) so tabs opened while drafting become the task's; deleted projects' layouts and view states are pruned with the tasks' in TaskContext. Review submit from a diff tab at the composer appends the review to the prompt (DiffView destination=prompt wording). Code review round 1 fixes: project-root queries invalidated when a non-worktree task in the same checkout reports changes (invalidationsFor takes root ids) plus refetchOnWindowFocus for project roots; useComposerProject subscribes via a projectId selector; useProjectFileSearch folded into useFileSearch({quietRefusals}). Verified in a browser on an isolated server (port 4599, scratch db) with three projects: worktree (dirty, Backlog.md), main checkout, and a subdirectory project; bun run test 1742 unit + 424 render pass, tsc clean.
<!-- SECTION:NOTES:END -->
