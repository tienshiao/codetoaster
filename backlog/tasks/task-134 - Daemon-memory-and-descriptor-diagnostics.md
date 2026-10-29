---
id: TASK-134
title: Daemon memory and descriptor diagnostics
status: Done
assignee:
  - '@claude'
created_date: '2026-10-29T09:47:00Z'
updated_date: '2026-10-29T10:15:00Z'
labels:
  - backend
  - diagnostics
dependencies: []
priority: medium
ordinal: 136000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A long-running daemon reached a 7.9 GB physical footprint (13 GB peak) after 11 days while its RSS read 240 MB, because most of it was swapped out; nothing the daemon reports could show that, say when it happened, or say what was holding descriptors (92 leaked directory handles, traced to Bun 1.3.9 not releasing fs.watch handles). Synthetic load on the PTY, git-spawn and watcher paths did not reproduce growth, so the next spike has to be caught live: the daemon needs to report its real footprint, its peak and when it was reached, and leave a mark in its log when it grows past a threshold.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 GET /api/diagnostics reports Bun version, uptime, RSS, JS heap, physical footprint (macOS), the peak footprint and when it was reached, open descriptors by kind, and counts of PTYs, connected clients and watch streams
- [x] #2 `codetoaster status` prints the memory and descriptor summary from that route
- [x] #3 The daemon logs one line each time its footprint first crosses 1, 2, 4, 8... GB, with the time
- [x] #4 Sampling is cheap enough to run every minute for the life of the daemon (no subprocess per sample)
- [x] #5 Route-level tests cover the endpoint through a real Bun.serve, and the sampler and threshold logic are unit tested with an injected clock and readings
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. src/lib/diagnostics.ts: footprint, lifetime peak and resident size from proc_pid_rusage via bun:ffi (Linux: /proc/self/status), descriptors by kind from /dev/fd, JS heap type counts, MemorySampler with injected read/now/log that tracks the peak and logs each doubling from 1 GB. 2. GET /api/diagnostics in the guarded API table; heap walk opt-in with heap=1. 3. TaskManager.diagnosticCounts, PtyManager.size, highlight cacheStats, WatchPool stats. 4. Sampler started once a minute in server.ts, stopped on shutdown. 5. codetoaster status prints the summary. 6. Tests: unit (sampler, readings, descriptors, formatBytes) and route through Bun.serve. 7. Wiki runbook.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Struct offsets for rusage_info_v4 checked against footprint(1) on the live daemon (8008/13267 MB vs 8010 MB/13 GB). Found while verifying: Bun's process.memoryUsage().rss on macOS is the physical footprint, not resident size, so rss is taken from ri_resident_size. Review findings fixed: infinite loop on a non-positive threshold, formatBytes unit boundary rounding, watchedTasks counting dead watches, order-dependent route test; the heap walk made opt-in so status does not pause the event loop; unreadable /dev/fd reported as unknown. Verified on an isolated dev server and on a compiled binary (bun:ffi works under --compile: 13 MB vs footprint(1) 12 MB).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The daemon now reports its real memory: GET /api/diagnostics returns the Bun version, uptime, physical footprint, the kernel's lifetime peak, the sampled peak with its time, resident size, JS heap (object types with heap=1), open descriptors by kind, and PTYs, clients, watch streams and highlight cache size. codetoaster status prints a summary of it. A MemorySampler reads the footprint once a minute with one syscall and logs a line the first time each doubling from 1 GB is crossed, with the time, so the next spike can be tied to what was happening. Tests: src/lib/diagnostics.test.ts and the route test src/api/diagnostics.test.ts through a real Bun.serve; full bun run test and typecheck clean (one unrelated worktree.test.ts timing flake under load, passing alone and on rerun). Code review ran at high with fixes applied; verified on an isolated server and a compiled binary. Wiki: runbooks/diagnose-daemon-memory.md. Not live until the binary is rebuilt and the daemon restarted.
<!-- SECTION:FINAL_SUMMARY:END -->
