---
id: TASK-142
title: Evict symbol indexes for directories and commits nobody is browsing
status: Done
assignee:
  - '@claude'
created_date: '2026-11-05T09:20:00Z'
updated_date: '2026-11-07T02:08:00Z'
labels:
  - backend
dependencies: []
ordinal: 146000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The symbol store (src/lib/symbols/store.ts) keeps one index per directory and one per commit in module-level maps that are never evicted. Go-to-definition and symbol search in a directory builds a full index for it, and TASK-138.2 made that reachable for every subagent worktree a user browses: each one stays in daemon memory after the worktree is removed, so the daemon grows with every worktree, project and commit ever looked at. Raised by the TASK-138.2 code review; project directories and commits have the same gap.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An index for a directory that no longer exists is dropped the next time the store is consulted or swept
- [x] #2 Indexes not used for a configurable idle period are evicted, with the clock injected
- [x] #3 The number of commit indexes held at once is bounded, least recently used evicted first
- [x] #4 A lookup after eviction rebuilds the index and answers the same as before
- [x] #5 The store's index count and size show in GET /api/diagnostics
- [x] #6 Unit tests cover the removed-directory, idle and commit-bound cases
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Finding: the store already caps indexes LRU (4 working trees, 3 commits, busy ones exempt), so AC3 holds as is; the gap is an index outliving its directory or its use until four others push it out. 2. Each index records lastUsed (source clock) and its source exists() probe; gitProjectSource and commitSource stat the directory. 3. sweepSymbolIndexes({ now, idleMs }) drops non-busy indexes idle past idleMs or whose directory is gone, rechecking after the await. 4. server.ts runs it every minute on Date.now (unref timer); idle period from --symbols-after / CODETOASTER_SYMBOLS_AFTER, default 30m, 0 disables idle eviction, plumbed like --uploads-after through daemonArgs. 5. symbolStoreStats() feeds symbolIndexes/symbolIndexFiles/symbolIndexEntries into /api/diagnostics counts and the status Holding line. 6. Tests: store sweep cases (removed dir, idle, busy kept, rebuild answers same), commit cap, daemonArgs, diagnostics counts.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Symbol indexes now leave memory when nobody uses them. The store already capped indexes LRU (4 working trees, 3 commits, busy ones exempt), so AC3 held; the gap was an index outliving its directory or its use until four others pushed it out, which for a removed subagent worktree was usually the life of the daemon. Each index records lastUsed and its source exists() probe; sweepSymbolIndexes({ now, idleMs }) drops non-busy indexes idle past idleMs or whose directory has gone, and the daemon runs it once a minute (unref timer, stopped on shutdown). The idle period is --symbols-after / CODETOASTER_SYMBOLS_AFTER, default 30m, 0 off, passed through daemonArgs like --uploads-after. /api/diagnostics counts gain symbolIndexes, symbolCommitIndexes, symbolIndexFiles, symbolIndexEntries; status prints the index count. Code review (--fix): 4 of 6 findings fixed - the probe closure retained commitSource batches (now a module-level directoryProbe), the idle path could delete a replacement index (snapshot recheck, with a regression test), a stat error other than ENOENT/ENOTDIR read as gone (now rethrown, so the index stays), and a start.test that --symbols-after reaches the server; skipped the clock-source note and a trivial comment (fixed by hand). Verify: isolated server with --symbols-after 1m dropped an index ~2 min after its last use and rebuilt it on the next lookup; with --symbols-after 0, deleting a scratch repo dropped its index within 46 s while the other stayed. Tests: typecheck clean; render 595/595; unit 2185 pass with one 4 s spawn-timing flake in manager.test (load average ~20; passes alone and alongside start.test).
<!-- SECTION:FINAL_SUMMARY:END -->
