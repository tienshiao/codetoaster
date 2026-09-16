---
id: TASK-108
title: File paths in a task's terminals are links that open a file tab
status: To Do
assignee: []
created_date: '2026-09-16 22:50'
labels:
  - frontend
  - terminal
dependencies:
  - TASK-86
references:
  - src/frontend/utils/backlog-links.ts
  - src/frontend/hooks/use-backlog-links.ts
  - src/frontend/Terminal.tsx
  - src/frontend/components/tabs/panes/TabPane.tsx
ordinal: 110000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Agents name files constantly ('Updated src/api/files.ts:263', 'see ./README.md', a Read of /abs/path/in/repo.ts) and the user has no way to go from that text to the file. Like task ids (TASK-86), a file path in the agent's terminal or a shell tab should be a link: underlined on hover, and a click opens the file in a { kind: 'file', path } tab through the layout store, focusing the tab if it is already open. Follow TASK-86's shape: a DOM-free matcher plus an xterm ILinkProvider in a module of its own, handed to XTerminal through its linkProvider prop, with the same plain-click activation. Resolve relative paths against the task's root (the worktree when there is one), and accept absolute paths only when they fall inside that root. Only paths that exist are links, so ordinary prose with slashes does not light up: check candidates against the task's file list or ask the server, cached, and not a request per hover. Handle the forms agents actually print: bare relative paths, ./ prefixes, absolute paths, and a trailing :line or :line:col suffix, which should open the file scrolled to that line if the file view supports it (otherwise it opens the file and the suffix is ignored). Surrounding punctuation such as quotes, backticks, parentheses and trailing periods or commas is not part of the path. URLs stay with the web links addon, and a task id stays with the backlog provider; neither is double-matched. Paths wrapped across terminal lines are a stretch goal.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A path to an existing file in the task's root, printed relative, ./-prefixed or absolute, is underlined on hover in the agent's terminal and shell tabs, and a click opens it in a file tab, focusing it if already open
- [ ] #2 A :line or :line:col suffix is part of the link and opens the file at that line when the file view can scroll to it
- [ ] #3 Nonexistent paths, paths outside the task's root, URLs and backlog task ids are not matched by this provider; surrounding quotes, backticks, brackets and trailing punctuation are excluded from the link
- [ ] #4 Existence checks are cached or batched, so hovering does not send a request per hover
- [ ] #5 The matcher has unit tests covering the forms above; registration and activation have a rendering test alongside TASK-86's
<!-- AC:END -->
