---
type: Runbook
title: Diagnose daemon memory
description: Read the daemon's real footprint, its peak and when it was reached, its descriptors and what it is holding from codetoaster status or GET /api/diagnostics, and find threshold crossings in its log.
tags: [runbook, memory, diagnostics, daemon, macos]
level: project
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-29T10:30:00Z }
sources:
  - id: diagnostics
    resource: ../../src/lib/diagnostics.ts
    title: src/lib/diagnostics.ts
  - id: diagnostics-route
    resource: ../../src/api/diagnostics.ts
    title: src/api/diagnostics.ts
  - id: task-134
    resource: "../../backlog/tasks/task-134 - Daemon-memory-and-descriptor-diagnostics.md"
    title: "TASK-134 — Daemon memory and descriptor diagnostics"
---

# Read the right number

On macOS the figure that matters is the **physical footprint**, what Activity Monitor calls Memory: resident plus compressed and swapped dirty pages. RSS is not it. A daemon that had run for eleven days had a 7.9 GB footprint and a 13 GB peak while its RSS read 240 MB.[^task-134] The daemon reads its own footprint and the kernel's lifetime peak with `proc_pid_rusage`, one syscall, through `bun:ffi`.[^diagnostics]

# Steps

1. `codetoaster status` prints the Bun version, the footprint with the kernel's peak and the sampled peak with its time, resident size and JS heap, open descriptors by kind, and the PTYs, clients and watch streams held.
2. For the full body, `curl -s http://localhost:4000/api/diagnostics`; beyond the summary it carries the highlight cache's size. Add `?heap=1` for the JS heap's most numerous object types: it walks the heap on the event loop, so it is opt-in and `status` does not ask for it.[^diagnostics-route]
3. Look for the threshold lines in `~/.codetoaster/codetoaster.log`: `Memory: footprint passed 4 GB at <ISO time> (...)`. The daemon samples once a minute and logs the first crossing of each doubling from 1 GB, so the time of a spike can be matched to what was happening then.[^diagnostics]
4. Many directory descriptors (`lsof -p <pid>`, type `DIR`) on repositories with no live task are the [Bun 1.3.9 watch leak](/gotchas/bun-fs-watch-descriptor-leak.md); check the Bun version first.

# Reading the breakdown

`footprint(1)` and `vmmap --summary` on the daemon's pid give the categories. Bun's native heap (spawned processes' output, HTTP bodies, buffers) is under a VM tag whose label depends on the Bun version: a 1.3.9 binary's showed as **IOAccelerator**, which in a Bun process is not GPU memory, and a 1.4.3 binary's shows as **app-specific tag 1**. **WebKit malloc** is JavaScriptCore's allocator: JS objects and strings. `JS VM Gigacage` holds typed arrays, including the headless terminals' buffers.[^task-134]

`process.memoryUsage().rss` is not resident size on macOS: Bun reads the footprint for it. The `rss` that `/api/diagnostics` reports is the kernel's resident size from the same `proc_pid_rusage` call, so it can be compared with the footprint.[^diagnostics]

# What has been ruled out

Under synthetic load on Bun 1.4.4 and 1.3.9, memory stayed flat for heavy terminal output through the real `Pty` class, 500 PTYs created and killed, 2,400 `gitSpawn` calls, and watcher churn with 120,000 file writes. A spike is more likely one large payload than a steady leak in those paths.[^task-134]

[^diagnostics]: src/lib/diagnostics.ts
[^diagnostics-route]: src/api/diagnostics.ts
[^task-134]: TASK-134 — Daemon memory and descriptor diagnostics
