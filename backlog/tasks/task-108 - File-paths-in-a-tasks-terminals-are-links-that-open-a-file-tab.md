---
id: TASK-108
title: File paths in a task's terminals are links that open a file tab
status: Done
assignee:
  - '@tma'
created_date: '2026-09-16 22:50'
updated_date: '2026-09-16 23:38'
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
- [x] #1 A path to an existing file in the task's root, printed relative, ./-prefixed or absolute, is underlined on hover in the agent's terminal and shell tabs, and a click opens it in a file tab, focusing it if already open
- [x] #2 A :line or :line:col suffix is part of the link and opens the file at that line when the file view can scroll to it
- [x] #3 Nonexistent paths, paths outside the task's root, URLs and backlog task ids are not matched by this provider; surrounding quotes, backticks, brackets and trailing punctuation are excluded from the link
- [x] #4 Existence checks are cached or batched, so hovering does not send a request per hover
- [x] #5 The matcher has unit tests covering the forms above; registration and activation have a rendering test alongside TASK-86's
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. utils/path-links.ts (DOM-free): indexFiles(FilesResponse) gives root plus a set of file paths; findPathLinks(line, index, cwd) tokenises on whitespace, quotes, backticks, brackets and asterisks, skips URLs, strips trailing punctuation, splits an optional :line or :line:col suffix, resolves absolute paths under root and relative paths against the task cwd then root with dot segments normalised, and keeps only paths in the file set. createPathLinkProvider mirrors createBacklogLinkProvider, sharing its column mapper. 2. combineLinkProviders(...factories) in the same place as the backlog provider so XTerminal keeps one linkProvider prop: one factory passes through unchanged, two yield a provider that concatenates both answers. 3. hooks/use-path-links.ts builds the factory from useTaskFiles (cached, invalidated by change-invalidation, no per-hover request) and the task cwd from taskById, both read through refs; activation opens file tab with line as a permanent tab. 4. TabPane combines both providers. 5. Tests: matcher and provider unit tests, TabPane render test for registration and activation.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Existence is a set lookup against the task file list (useTaskFiles, the Explorer query; refetched by change-invalidation), so hovering sends nothing. Gitignored files are therefore never links. Relative paths try the agent cwd, then the repo root; shell tabs share the agent cwd since the client does not know a shell's own. XTerminal keeps one linkProvider prop: combineLinkProviders in utils/terminal-links.ts merges the backlog and path factories and returns a lone factory unchanged; the column mapper moved there too. Wrapped paths (stretch goal) are not handled. Validation: bun run test green (1599 unit, 363 render), tsc clean; in Chrome on an isolated server, a shell task echoing a mixed line underlined src/api/files.ts:263 without the comma and README.md without its brackets, left nope/x.ts and the URL path to the web links addon, and a click opened files.ts at line 263.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
File paths in a task's agent and shell terminals are links: relative, ./-prefixed, @-mentioned and in-root absolute paths to existing files, with an optional :line or :line:col suffix, open a file tab (at the line when given). Checked against the cached task file list, so there is no request per hover. Covered by matcher, provider and combinator unit tests and TabPane render tests, and checked in the browser.
<!-- SECTION:FINAL_SUMMARY:END -->
