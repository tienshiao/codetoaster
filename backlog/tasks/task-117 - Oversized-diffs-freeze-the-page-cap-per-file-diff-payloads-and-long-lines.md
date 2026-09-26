---
id: TASK-117
title: 'Oversized diffs freeze the page: cap per-file diff payloads and long lines'
status: To Do
assignee: []
created_date: '2026-09-26 10:23'
labels:
  - frontend
  - backend
  - bug
dependencies: []
priority: high
ordinal: 119000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Selecting the SweepSpotter backend task froze and killed the tab in Chrome and Zen. GET /api/tasks/:id/diff for that task returns 50 MB, 44 MB of it one tracked file (data/los-angeles/street-sides.geojson) whose diff is 9 lines because the file is a single 22 MB line on each side. useTaskDiff (shared by the Explorer rail, the Changes panel, the command palette and every diff tab) fetches the whole payload, then parseDiff, enhanceWithWordDiff (char-by-char tokenize and LCS over the line pair) and the regex tokenizeLine run synchronously in render, and React hands the browser two 22 MB text nodes to lay out. It reruns on every checkout change while the agent edits files. Nothing caps this today: the server tokenizer bails over 1 MB (lib/highlight/tokenize.ts) but the diff route (api/diff.ts), diffUntrackedFiles, parseDiff, wordDiff.ts, syntaxHighlight.ts and DiffLayout have no byte or line-length guard. Measured 2026-09-26 against the live server; the commit diff route and FileContent have the same exposure. Fix at the server first: keep a file's headers but replace its hunks with a marker once a file's diff exceeds a byte budget or contains a line over a length budget, have the parser turn the marker into an oversized flag carrying the sizes, and render it the way binaries render with a note such as 44 MB, 1 line, not shown. Apply the same to the commit diff route. Then guard the client: computeWordDiff and tokenizeLine skip any line past the length budget so a long minified line through any other path renders plain instead of hanging the tab.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Selecting a task whose working tree contains a multi-megabyte single-line file no longer freezes the page; the diff request for it completes in well under a second and the payload is kilobytes
- [ ] #2 A file whose diff exceeds the byte budget or contains a line over the length budget is listed in the file tree and the Changes panel with its sizes and an explanation, and its hunks are not rendered
- [ ] #3 Normal files in the same diff still render with word-level and syntax highlighting
- [ ] #4 The commit diff view applies the same cap, so History cannot freeze on the commit that lands such a file
- [ ] #5 Word-level diffing and client tokenizing skip lines past the length budget on every code path that renders diff lines
- [ ] #6 Unit tests cover the server cap (byte and line-length triggers, headers preserved, marker emitted), the parser flag, and the client guards
- [ ] #7 Verified against a copy of the SweepSpotter working tree or a fixture with a 20 MB single-line file
<!-- AC:END -->
