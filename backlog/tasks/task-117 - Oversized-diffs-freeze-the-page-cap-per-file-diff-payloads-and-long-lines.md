---
id: TASK-117
title: 'Oversized diffs freeze the page: cap per-file diff payloads and long lines'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-26 10:23'
updated_date: '2026-09-26 16:01'
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
- [x] #1 Selecting a task whose working tree contains a multi-megabyte single-line file no longer freezes the page; the diff request for it completes in well under a second and the payload is kilobytes
- [x] #2 A file whose diff exceeds the byte budget or contains a line over the length budget is listed in the file tree and the Changes panel with its sizes and an explanation, and its hunks are not rendered
- [x] #3 Normal files in the same diff still render with word-level and syntax highlighting
- [x] #4 The commit diff view applies the same cap, so History cannot freeze on the commit that lands such a file
- [x] #5 Word-level diffing and client tokenizing skip lines past the length budget on every code path that renders diff lines
- [x] #6 Unit tests cover the server cap (byte and line-length triggers, headers preserved, marker emitted), the parser flag, and the client guards
- [x] #7 Verified against a copy of the SweepSpotter working tree or a fixture with a 20 MB single-line file
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. src/lib/diff/oversized.ts (import-free, shared by server and client): the marker line format and its regex, plus formatOversizedMarker(bytes, additions, deletions, longestLine). 2. src/api/diff-cap.ts: capDiff(diff, budgets) splits at 'diff --git ' boundaries, measures each file section's length and longest line in one pass, and for a section over MAX_FILE_DIFF_BYTES (1_000_000) or MAX_DIFF_LINE_CHARS (20_000) keeps every header line before the first @@ and replaces the hunks with one marker carrying bytes, +adds -dels and longest line; other sections pass through byte-for-byte. 3. Apply capDiff in workingTreeDiff (api/diff.ts) and after stripToFirstDiff in the commit route (api/git.ts); hash the capped text. 4. FileDiff.oversized {bytes, longestLine}; parseDiff recognises the marker outside hunks and sets the flag and the counts. 5. DiffFile renders an oversized file like a binary with a sentence carrying the sizes; use-task-diff and use-git-commit exclude oversized files from the token request. 6. Client backstops: computeWordDiff returns plain segments when either side exceeds MAX_WORD_DIFF_CHARS (2_000) or the token product exceeds 1_000_000; tokenizeLine returns one plain token past MAX_TOKENIZE_CHARS (20_000). 7. Tests: diff-cap, parseDiff, wordDiff, syntaxHighlight, api/diff route with a 1.5 MB single-line fixture, commit route if a fixture pattern exists. 8. Verify on an isolated server against a scratch repo with a modified 20 MB single-line JSON.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented: src/lib/diff/oversized.ts holds the marker format shared by server and client; src/api/diff-cap.ts caps a file section past 1 MB or a 20k-char line by keeping its headers and replacing the hunks with one marker carrying bytes, +adds -dels and the longest line; applied in workingTreeDiff and the commit route before hashing. parseDiff turns the marker into FileDiff.oversized with the counts; DiffFile renders it like a binary with the sizes; the token request skips oversized files; computeWordDiff and tokenizeLine skip over-budget lines as client backstops. Runtime on an isolated server against a scratch repo with a tracked 20 MB single-line GeoJSON modified beside a README edit: the diff response is 358 bytes in about 250 ms instead of 40 MB, the README keeps its hunk, the GeoJSON carries the marker with +1 -1 and longest line 20,000,121; in Chrome the task page renders instantly, the Changes panel shows both files with their counts, and the GeoJSON tab reads 'Diff not shown: 38 MB, longest line 20,000,121 characters'.

Committed as c4862ef on worktree-task-117-oversized-diff. bun test 1840 pass, vitest 429 pass, tsc clean. Code review (high) running.

Code review (high) on c4862ef: no defects in the cap, marker or parser; seven items about reach and cost. Applying five: the context-expansion route truncates lines past the length budget so expanding a hunk cannot pull a 20 MB line into the DOM; a whole-diff budget (5 MB) caps further sections once the kept total passes it, so hundreds of just-under-budget files cannot add up to a freeze; the word-diff character guard rises to the tokenizer budget since the LCS cell guard already bounds the quadratic cost; capDiff classifies sections in one pass without slicing those under budget; the reported longest line excludes the diff prefix. Deferred, noted for follow-up: the full 44 MB patch is still generated and buffered on the server on every refetch before the cap runs; deciding oversized paths up front (file size for untracked files, a numstat pre-pass for tracked ones) and excluding them from the patch run would remove that cost, but it touches staged, unstaged, untracked and rename handling and deserves its own task. Skipped: the new tests write fixtures the way the surrounding tests in that file already do.

Review round applied and folded into 217ef7e: the context route truncates over-budget lines with a suffix; a 5 MB whole-diff budget; the word-diff character guard equals the tokenizer budget with the LCS cell guard as the real bound; capDiff scans once and slices only capped sections; the reported longest line is the file's own. Re-driven against the fixture: 358 bytes in about 270 ms, README hunk intact, marker now reports longest line 20,000,120 which matches the file. tsc clean; final review (medium) running.

Final review (medium) on 217ef7e found one real issue: mid-conflict, plain diff output prints conflicted files under a diff --cc header, which the cap did not treat as a section boundary, so a large conflict folded into the file before it and capped that file's small diff. Fixed in 939a171 by splitting at diff --git, diff --cc and diff --combined, with a regression test. The parser has the same blind spot for combined diffs, but that predates this task and is left as is. Final: bun test 1847 pass, vitest 429 pass, tsc clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Oversized diffs no longer freeze the page. The server caps each file section past 1 MB or a 20,000-character line, and every section once 5 MB has been kept, by keeping its headers and replacing its hunks with one marker line that carries the bytes, the +/- counts and the longest line. The working-tree and commit diff routes both apply it, and the context-expansion route truncates over-budget lines. The parser turns the marker into an oversized flag, the diff view shows it like a binary with the sizes, and the token request skips it. As backstops, word diffing and the client tokenizer skip over-budget lines. Verified with unit and route tests (bun test 1847, vitest 429, tsc clean), and on an isolated server against a scratch repo with a modified 20 MB single-line GeoJSON: the diff response dropped from 40 MB to 358 bytes in about 250 ms, the neighbouring README kept its hunk, and in Chrome the page rendered at once with the file reading 'Diff not shown: 38 MB, longest line 20,000,120 characters'. Two review rounds; the second found the combined-diff boundary bug, fixed in 939a171. Deferred: the server still generates and buffers the full patch before capping it on every refetch. Removing that cost means deciding oversized paths before the patch runs, which is its own task.
<!-- SECTION:FINAL_SUMMARY:END -->
