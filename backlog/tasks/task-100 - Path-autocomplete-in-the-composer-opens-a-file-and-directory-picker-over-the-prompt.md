---
id: TASK-100
title: >-
  Path autocomplete in the composer: @ opens a file and directory picker over
  the prompt
status: Done
assignee:
  - '@claude'
created_date: '2026-09-09 08:44'
updated_date: '2026-09-09 09:58'
labels:
  - frontend
  - api
dependencies: []
ordinal: 104000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Typing @ in the composer's prompt opens a suggestion list under the textarea, the way other agent UIs do, so a path can be named without leaving the box or remembering it exactly. The token after @ is the query: one starting with / or ~ completes absolute paths through the existing /api/directories lister (extended to return files as well), anything else fuzzy-matches the tracked files of the selected project, relative to its directory, through a new project-scoped search route that shares the task-scoped one's matcher. Accepting a suggestion replaces the @query span with @path — the @ stays, so putting the caret back into the token and typing re-opens the list on the edited prefix rather than needing the whole path deleted and retyped. A file gets a trailing space (the token is done); a directory gets a trailing / and the list stays open one level down. The popover is under the textarea, not at the caret. Built on the plain textarea, not CodeMirror or Monaco: the prompt is prose, and ⌘⏎, paste-to-attach and drag counting already live on this field.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Typing @ followed by text in the prompt opens a suggestion list under the textarea; no @ at a word start (mid-word, or in an email address) opens nothing
- [x] #2 A query starting with / or ~ lists directories and files at that absolute path; any other query fuzzy-matches the selected project's tracked files by path
- [x] #3 Arrow keys move the highlight, Enter or Tab accepts, Escape closes the list and nothing else; ⌘⏎ still submits while the list is open, plain Enter does not submit while it is open
- [x] #4 Accepting writes @path over the @query span and puts the caret after it: a file ends the token with a space, a directory ends it with / and re-queries inside it
- [x] #5 Editing an existing @token from the middle re-opens the list on the prefix up to the caret; merely clicking into one does not
- [x] #6 A project with no directory (General) still completes absolute paths and offers nothing for a relative query
- [x] #7 The list is mouse-selectable without blurring the textarea, and closes on blur
- [x] #8 Route tests cover the project-scoped file search (unknown project, project without a directory, a hit) and the directories route returning files; a unit test covers the token/insert arithmetic; render tests cover open, navigate, accept, Escape and ⌘⏎
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Server: extract the fuzzy scoring loop in api/files.ts into searchFiles(dir, q); add GET /api/projects/:id/files/search (404 unknown project, 400 no directory, else the same result shape as the task route). Extend /api/directories with ?files=1 returning entries:[{name,isDirectory}] alongside the existing directories array.
2. Pure module frontend/utils/mention.ts: findMention(text, caret) -> {start,end,query}|null (an @ at text start or after whitespace, no whitespace between it and the caret), applyMention(text, mention, path, {directory}) -> {text, caret}. bun test beside it.
3. Frontend: hooks use-project-file-search.ts and a files-aware variant of use-directories; MentionPopover component under the Textarea in Composer.tsx, keyed off onChange (never off caret movement alone), with the PathField listbox markup, mousedown-accept, capture-phase Escape, arrow/Enter/Tab handling before the composer's own onKeyDown.
4. Tests: route tests in api/files.test.ts, unit tests for mention.ts, render tests in Composer.render.tsx with fetch stubbed per URL.
5. Verify in Chrome from an isolated server per the verify skill.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Server: the inline /api/directories handler moved to src/api/directories.ts (spread into guardApiRoutes from server.ts, behaviour unchanged) and grew files=1, which adds entries:{name,isDirectory}[] - non-hidden children, same prefix filter, directories before files, each group localeCompare'd, 50 total. parent/directories/home are untouched, so PathField is unaffected.

api/files.ts: the scoring loop is now the exported searchFiles(dir, q), used by the task route and by the new GET /api/projects/:id/files/search - 404 for an unknown project, 400 for one with no directory, 400 'Not a repository' (the wording resolveTaskRoot uses) when the file lister throws, and an empty q gives []. It expands a project's tilde path itself, the way the manager does before it spawns anything.

Frontend: utils/mention.ts (findMention / isAbsoluteQuery / applyMention) is the whole arithmetic, apart from the component so bun test reaches it without a DOM. components/MentionSuggestions.tsx holds useMention - debounce, routing between the two sources, highlight, accept, capture-phase Escape, blur - and the listbox itself. Composer.tsx wraps the Textarea in a relative div and wires the hook; its onKeyDown asks the list first, and the list never takes Cmd/Ctrl-Enter, so submitting is the same keystroke open or shut. v2/Textarea grew a ref prop (React 19 passes one through a function component like any other) so the caret can be placed after an accept. use-directories takes {files}, which is in the query key because it changes the body; use-project-file-search resolves a non-OK response to {results: []} rather than throwing.

Two things worth knowing. The mention is set from onChange alone - that is the only reason clicking into a token opens nothing while typing inside one re-queries, and a caret listener could not tell those apart. And applyMention appends the token's trailing space unconditionally, so accepting mid-sentence leaves two spaces before the following word; eliding it when the next character is already whitespace would move the caret contract, so the doubled space is the deliberate trade and mention.test.ts pins it.

Tests: src/api/directories.test.ts (5), a project-search block in src/api/files.test.ts (5), src/frontend/utils/mention.test.ts (14), and a 'path completion' describe in Composer.render.tsx (12). bun run test is green: 1508 pass / 0 fail on bun test, 337 pass / 0 fail on vitest; bunx tsc --noEmit -p . is clean. One trap for whoever runs the suite from inside a CodeToaster task: src/cli/hook.test.ts fails there because the session inherits CODETOASTER_ORIGIN and the spawned hook reports to the live daemon instead of the test's stand-in. Pre-existing and unrelated - the suite passes with that variable removed. Browser verification was left to the requester.

Verified in Chrome against an isolated server on :4599 (fresh --db, one project pointed at the worktree): @src/fro listed fuzzy hits under the textarea; ArrowDown+Enter wrote @src/lib/frontmatter.ts with a trailing space and the caret after it; @~/Proj listed Projects/ from the directories route; Tab drilled into it and kept the list open on ~/Projects/; Escape closed it and left the text alone; clicking into the middle of an existing token opened nothing, one Backspace there re-opened on the prefix and the whole token was replaced by a mouse accept; a@b.com opened nothing. Test runs: bun test 1508 pass, Vitest 337 pass, tsc clean — with CODETOASTER_ORIGIN cleared, since this session runs inside a task and hook.test.ts otherwise posts to the live daemon (pre-existing, not touched here). Known rough edge kept as specced: accepting a file mid-sentence always appends a space, so a following word gets two.

Review pass (code-review --fix): useMention now derives visibility (mention + answered query + not dismissed) instead of reconciling an open flag by effect, so Escape/blur dismissals stick, the document Escape listener is only installed while rows are on screen, Enter/Tab are swallowed while a directory's re-query is in flight (PathField's awaitingSuggestions gate), keys check the caret is still inside the token, Shift+Tab and IME-composition Enter pass through, and absolute rows are normalised so a prefix through home stays absolute and a bare ~ completes to ~/. Server: /api/directories caps directories and files separately, follows symlinks to classify them, and uses the shared lib/tilde.ts expandTilde (also used by manager.ts and files.ts); the project search distinguishes a missing directory from a non-repository, caches the ls-files answer per dir for 3s, and listGitFiles goes through gitSpawn. Wire types live in types/files.ts. Known and left as specced: paths containing spaces produce a token findMention cannot re-parse; PathField and MentionSuggestions still carry two copies of the listbox.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Composer @ completion: findMention/applyMention in utils/mention.ts, useMention + MentionSuggestions under the prompt, a project-scoped GET /api/projects/:id/files/search sharing searchFiles() with the task route, and files=1 on /api/directories (moved to api/directories.ts). Verified by unit, route and render tests and by hand in Chrome from an isolated server.
<!-- SECTION:FINAL_SUMMARY:END -->
