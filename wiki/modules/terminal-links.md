---
type: Module
title: Terminal links
description: Task ids, file paths, bare file names and commit hashes in a task's terminals are xterm links that open a task file, a file tab or a commit, each matched by a DOM-free provider.
tags: [terminal, xterm, links, frontend]
level: project
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-10T09:10:00Z }
sources:
  - id: terminal-links
    resource: ../../src/frontend/utils/terminal-links.ts
    title: src/frontend/utils/terminal-links.ts
  - id: path-links
    resource: ../../src/frontend/utils/path-links.ts
    title: src/frontend/utils/path-links.ts
  - id: task-86
    resource: "../../backlog/tasks/task-86 - Task-ids-in-a-tasks-terminals-are-links-that-open-the-task-file.md"
    title: "TASK-86 — Task ids in a task's terminals are links that open the task file"
  - id: task-108
    resource: "../../backlog/tasks/task-108 - File-paths-in-a-tasks-terminals-are-links-that-open-a-file-tab.md"
    title: "TASK-108 — File paths in a task's terminals are links that open a file tab"
  - id: task-109
    resource: "../../backlog/tasks/task-109 - Bare-file-names-in-a-tasks-terminals-open-the-file-with-a-chooser-when-several-match.md"
    title: "TASK-109 — Bare file names open the file, with a chooser when several match"
  - id: task-110
    resource: "../../backlog/tasks/task-110 - Commit-hashes-in-a-tasks-terminals-open-the-commit.md"
    title: "TASK-110 — Commit hashes in a task's terminals open the commit"
  - id: task-130
    resource: "../../backlog/tasks/task-130 - Gitignored-files-are-reachable-from-the-Files-tree-terminal-links-and-file-search.md"
    title: "TASK-130 — Gitignored files are reachable from the Files tree, terminal links and file search"
---

# What lights up

| Text in the terminal | Provider | Opens |
| --- | --- | --- |
| `TASK-86` | `backlog-links.ts` | The task's markdown file[^task-86] |
| `src/api/files.ts:263`, `./README.md`, an in-root absolute path | `path-links.ts` | A file tab, at the line when given[^task-108] |
| `Composer.tsx`, `panes/TabPane.tsx` | `path-links.ts` (tail match) | The file, or a chooser when several match[^task-109] |
| `c02b43a` | `commit-links.ts` | The commit in the git view[^task-110] |

URLs stay with xterm's web links addon, and no provider double-matches another's text.[^task-108]

# Shape

Each provider is a DOM-free matcher plus an xterm `ILinkProvider` in a module of its own. The rules — what a path looks like in prose, what is punctuation, what it resolves against — are the part worth testing, and none of it needs a grid.[^path-links]

`terminal-links.ts` holds what they share: the slice of xterm they read, typed structurally so a test needs no terminal, and the string-index-to-column mapper. The mapper is not the identity it looks like: a double-width cell (CJK, an emoji beside a task id) is one character of the string but two columns of the grid.[^terminal-links]

Providers are registered on the grid **one by one**, not combined into one. A provider that answers at once must not wait on one that asks the server — see [xterm link providers must answer synchronously](/gotchas/xterm-async-link-providers.md).[^terminal-links]

# Existence without a request per hover

Only paths that exist are links, so prose with slashes does not light up. Existence is a set lookup against the task's file list — the same query the Explorer's Files section already holds, refetched when the working tree changes (TASK-103). Hovering sends nothing.[^path-links]

The list names an ignored file like any other, but stops at an ignored directory: `dist` is in it, what `dist` holds is not (see [File listing and ignored files](/modules/file-listing.md)). A path under one cannot be confirmed, and the provider cannot ask the server, so it is linked on its shape alone:[^path-links][^task-130]

- the path resolves, against the cwd or the root, to somewhere under a listed ignored directory
- its last segment has an extension, the rule a bare name is held to; `dist/assets` is as likely a directory
- no listed file answers to the same text: a listed file under the cwd or the root is tried before any guess, so a file known to be there is never outranked by one that might be
- the text itself reaches into the ignored directory. A cwd already inside one confirms nothing: after `cd dist`, everything the agent prints would resolve under `dist`, and `e.g`, `v1.2` and every bare file name would become links to files that are not there

Such a link can name a file that is not there, and the tab it opens says so. A bare name is never searched for under an ignored directory.

Relative paths try the agent's cwd first, then the repository root. Absolute paths count only inside the task's root: a worktree task's agent can still print the main checkout's paths, and those are not this task's files.[^path-links]

# Related

The [markdown preview](/modules/markdown-preview.md) resolves its own links against the same file list, but fetches it on click rather than per hover.

[^terminal-links]: src/frontend/utils/terminal-links.ts
[^path-links]: src/frontend/utils/path-links.ts
[^task-86]: TASK-86 — Task ids in a task's terminals are links that open the task file
[^task-108]: TASK-108 — File paths in a task's terminals are links that open a file tab
[^task-109]: TASK-109 — Bare file names open the file, with a chooser when several match
[^task-110]: TASK-110 — Commit hashes in a task's terminals open the commit
[^task-130]: TASK-130 — Gitignored files are reachable from the Files tree, terminal links and file search
