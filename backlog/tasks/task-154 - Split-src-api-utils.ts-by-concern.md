---
id: TASK-154
title: Split src/api/utils.ts by concern
status: To Do
assignee: []
created_date: '2026-11-23T13:52:00Z'
labels:
  - server
  - api
  - chore
dependencies: []
priority: low
ordinal: 157000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
src/api/utils.ts is 870 lines with 26 exports and is imported by 19 files. It started as shared route helpers and became the place where anything needed by two routes ended up, so it now mixes unrelated concerns: resolving task, project and worktree roots and the rootRoutes wrapper; git process spawning (gitSpawn, gitSpawnRaw, GitSpawnOptions); untracked-file and intent-to-add diff helpers (diffUntrackedFiles, settledStages, withoutGitlinks, mapWithConcurrency); file listing (listGitFiles, listIgnoredEntries, buildFileListing, safePath, image MIME types); and small generic helpers (cachedPromise, coalesce, parseNonNegInt, SHA_RE). It is one of the most-edited server files, and an edit to one concern means reading through the others. CLAUDE.md names gitSpawn and gitSpawnRaw in api/utils.ts as the required way to run git, so that rule must keep pointing at the right place. This is a behaviour-preserving cleanup.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No behaviour change: bun run test and bun run typecheck are clean
- [ ] #2 utils.ts is gone or holds only genuinely generic helpers, and each new module covers one concern from the description
- [ ] #3 utils.test.ts is split to follow the modules it tests, with no test dropped
- [ ] #4 CLAUDE.md and wiki pages that name api/utils.ts (including the gitSpawn rule and the Bun shell deadlock gotcha) point at the new locations
<!-- AC:END -->
