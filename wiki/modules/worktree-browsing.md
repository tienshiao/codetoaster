---
type: Module
title: Worktree browsing
description: The Explorer lists the worktrees of a task's repository and can point Changes, Files, History, Refs and Backlog at any of them; the routes serve a worktree through a token naming its base root and path, and refuse a path that is not one of that repository's live worktrees.
tags: [module, worktrees, explorer, tabs, git]
level: project
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-06T00:00:00Z }
sources:
  - id: utils
    resource: ../../src/api/utils.ts
    title: src/api/utils.ts
  - id: route
    resource: ../../src/api/worktrees.ts
    title: src/api/worktrees.ts
  - id: token
    resource: ../../src/lib/worktree-token.ts
    title: src/lib/worktree-token.ts
  - id: repo-root
    resource: ../../src/frontend/repo-root.ts
    title: src/frontend/repo-root.ts
  - id: hook
    resource: ../../src/frontend/hooks/use-worktrees.ts
    title: src/frontend/hooks/use-worktrees.ts
  - id: explorer
    resource: ../../src/frontend/components/Explorer.tsx
    title: src/frontend/components/Explorer.tsx
  - id: layout
    resource: ../../src/frontend/layout-store.ts
    title: src/frontend/layout-store.ts
  - id: frame
    resource: ../../src/frontend/components/tabs/panes/WorktreeFrame.tsx
    title: src/frontend/components/tabs/panes/WorktreeFrame.tsx
  - id: task-138-2
    resource: "../../backlog/tasks/task-138.2 - List-a-tasks-worktrees-and-browse-files-and-diffs-on-any-of-them.md"
    title: "TASK-138.2 — List a task's worktrees and browse files and diffs on any of them"
---

# What it does

Subagents often work in their own git worktrees of the task's repository. Every Explorer section and every file and diff tab used to be rooted at the task's own checkout, so their changes could not be seen without leaving CodeToaster. The Explorer now lists the repository's worktrees and can browse any of them; the tabs it opens from one read that worktree and say so.[^task-138-2]

# The serving side

Every repository-reading route is written once against a resolved root and registered by `rootRoutes` under three prefixes: `/api/tasks/:id/…`, `/api/projects/:id/…` and `/api/worktrees/:token/…`.[^utils]

- **The token** is base64url, without padding, of the UTF-8 JSON `{scope, id, path}`: the base root's scope (`tasks` or `projects`), its id, and the worktree's absolute path. The codec is import-free, so the frontend and the server share it.[^token]
- **Resolving one** decodes the token (a malformed one is a 400), resolves the base root through its own resolver (its 404s and 400s pass through), then lists the base repository's worktrees with `git worktree list --porcelain`. The path is served only when its realpath is one of the live entries; otherwise the answer is 404 `Worktree not found`.[^utils]
- **Live** means listed, neither bare nor prunable, and on disk now. The listing is cached for three seconds per repository, but the directory is checked on every request, so a `git worktree remove` stops serving the path at once.[^utils]
- **Realpaths** are compared on both sides, because git and the client need not spell a path the same way (`/tmp` and `/private/tmp` on macOS).

`GET <root>/worktrees` lists the live worktrees with their path, branch (null when detached), HEAD, and `current` for the root's own checkout.[^route]

# The client side

`RepoRoot` has a third kind, `{ kind: "worktree", base, path }`.[^repo-root]

- `rootApi` builds the token; `rootId` is `worktree:<base id, URI-encoded>:<path>`, so caches and view-state slots for a worktree are its own. `baseRootId` recovers the base, which is how the view-state sweep keeps a worktree's slots for as long as its task or project lives.
- Nothing on the server watches a worktree, so a worktree root refetches on window focus as a project root does, and change highlighting (TASK-136) is off for it.

# The picker

The Explorer draws a v2 `Select` above the section when the list holds more than one worktree. Each option is the branch, or a short SHA when detached, and the directory name, except that the directory is dropped when the branch already names it as whole words (Claude Code puts `.claude/worktrees/<name>` on `worktree-<name>`); the root's own checkout is marked. A label longer than the chip ends in an ellipsis rather than wrapping (TASK-144).[^explorer]

- The choice is stored in the base root's `explorer` view-state slot, so it survives a remount and a reload. A stored choice is honoured while the list is loading, so a reload does not first draw the task's checkout.[^hook]
- A choice the loaded list no longer holds falls back to the root's own checkout and is cleared. A list that failed to load also falls back, but keeps the choice, because a failure proves nothing.
- Changes, Files, History, Refs and Backlog read the chosen worktree. Processes always reads the task, and shows no picker.
- The list is polled every 15 seconds and on focus, because a subagent adds and removes worktrees with nothing to announce it.

# Tabs on a worktree

`file`, `diff` and `diffAll` descriptors carry an optional `worktree` path. The Explorer stamps it centrally on every tab it opens while a worktree is chosen.[^layout]

- **The tab key** is `worktree:<path, URI-encoded>:<key>`, so the same path on two worktrees is two tabs. It round-trips through `descriptorFromKey` and layout persistence, so `?tab=` links reach it as well.
- **The pane** reads through the worktree's root. Its view-state slot stays under the task's root id, so closing the tab prunes it. What it opens (View file, Show changes, a markdown link) stays on the same worktree.
- **Which worktree** is named by a mono line above the pane, showing the branch and the directory, with the full path as its tooltip. The tab strip adds the directory to the tab's detail.[^frame]
- **A gone worktree** is reported in place of the pane: once the list (asked again whenever the tab mounts) no longer holds the path, the pane says "This worktree no longer exists." instead of showing the route's 404.

[^utils]: src/api/utils.ts
[^route]: src/api/worktrees.ts
[^token]: src/lib/worktree-token.ts
[^repo-root]: src/frontend/repo-root.ts
[^hook]: src/frontend/hooks/use-worktrees.ts
[^explorer]: src/frontend/components/Explorer.tsx
[^layout]: src/frontend/layout-store.ts
[^frame]: src/frontend/components/tabs/panes/WorktreeFrame.tsx
[^task-138-2]: TASK-138.2 — List a task's worktrees and browse files and diffs on any of them
