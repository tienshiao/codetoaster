---
id: TASK-154
title: Split src/api/utils.ts by concern
status: Done
assignee:
  - '@claude'
created_date: '2026-11-23T13:52:00Z'
updated_date: '2026-11-23T15:31:00Z'
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
- [x] #1 No behaviour change: bun run test and bun run typecheck are clean
- [x] #2 utils.ts is gone or holds only genuinely generic helpers, and each new module covers one concern from the description
- [x] #3 utils.test.ts is split to follow the modules it tests, with no test dropped
- [x] #4 CLAUDE.md and wiki pages that name api/utils.ts (including the gitSpawn rule and the Bun shell deadlock gotcha) point at the new locations
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Move gitSpawn/gitSpawnRaw/GitSpawnOptions to src/lib/git/spawn.ts (lib modules import it; removes the api/utils to lib/tasks/manager to lib/worktree to api/utils import cycle). 2. Move file listing (listGitFiles, listIgnoredEntries, buildFileListing, FileInfo, safePath, image MIME types) to src/lib/file-listing.ts. 3. Move untracked and intent-to-add diff helpers to src/api/untracked-diff.ts. 4. Move root resolution, worktree listing and rootRoutes to src/api/roots.ts. 5. utils.ts keeps cachedPromise, coalesce, parseNonNegInt, SHA_RE, mapWithConcurrency. 6. Importers updated directly, no re-export shims; utils.test.ts split to follow; CLAUDE.md and wiki pages repointed. 7. Test count unchanged; review and verify.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done as planned. Files: lib/git/spawn.ts (135 lines), lib/file-listing.ts (152), api/roots.ts (~290), api/untracked-diff.ts (187), api/utils.ts (112, generic helpers only). No lib module imports from api any more, so the api/utils to tasks/manager import cycle is gone. utils.test.ts split into utils.test.ts, lib/git/spawn.test.ts, lib/file-listing.test.ts with the same 11 tests; diff.test.ts subprocess scripts repointed. Two moved comments were stale and fixed (listGitFiles pointer, cachedToplevel's inlining note). docs/v2-architecture.md and docs/git-view-plan.md still name api/utils.ts; left as historical plans.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Split src/api/utils.ts by concern, moving bodies verbatim. Git spawning went to lib/git/spawn.ts and file listing to lib/file-listing.ts, since lib modules use both. Root resolution and rootRoutes went to api/roots.ts, untracked and intent-to-add diffs to api/untracked-diff.ts, and utils.ts keeps only generic helpers. Every importer imports the new module directly, with no shims. CLAUDE.md and three wiki pages were repointed. Review (/code-review high --fix): no findings; it confirmed moves are verbatim, all 11 tests kept, and the import cycle is gone. Tests: unit 2294 before and after, render 643 pass, typecheck clean. Verify: on an isolated server (port 4599, scratch db), diff, files, search, file, git log/refs/commit/tree/file, symbols, backlog and worktrees answered 200 for a shell task; a bad sha gave 400 and an unknown task 404; worktree-token routes answered for a live worktree, 404 for a path outside the repo and 400 for a garbage token; project routes gave 400 for the directoryless general project and 404 for an unknown one.
<!-- SECTION:FINAL_SUMMARY:END -->
