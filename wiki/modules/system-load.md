---
type: Module
title: System load sampler and rail indicator
description: One daemon-wide sampler reads machine CPU from os.cpus() deltas and os.loadavg() every 2 seconds into a 10-minute ring, sends the ring to each socket as it opens and pushes every tick to all clients; the right rail shows the current figure with a sparkline, and a hover or focus card charts the window with the load averages.
tags: [frontend, backend, websocket, v2, perf, remote]
level: project
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-23T04:12:21Z }
sources:
  - id: sampler
    resource: ../../src/lib/system-load.ts
    title: src/lib/system-load.ts
  - id: types
    resource: ../../src/lib/xtmux/types.ts
    title: src/lib/xtmux/types.ts
  - id: server
    resource: ../../src/server.ts
    title: src/server.ts
  - id: store
    resource: ../../src/frontend/system-load-store.ts
    title: src/frontend/system-load-store.ts
  - id: indicator
    resource: ../../src/frontend/components/v2/SystemLoad.tsx
    title: src/frontend/components/v2/SystemLoad.tsx
  - id: chart
    resource: ../../src/frontend/components/v2/load-chart.ts
    title: src/frontend/components/v2/load-chart.ts
  - id: hovercard
    resource: ../../src/frontend/components/v2/HoverCardParts.tsx
    title: src/frontend/components/v2/HoverCardParts.tsx
  - id: task-149
    resource: "../../backlog/tasks/task-149 - System-load-indicator-in-the-side-rail-with-a-load-over-time-hover-card.md"
    title: "TASK-149 — System load indicator in the side rail with a load-over-time hover card"
---

# Why

Working locally, the user keeps Activity Monitor's CPU graph open while agents run. Over a remote link there was no equivalent: `top` in a terminal tab takes a tab, has to be looked at on purpose, and shows only the present. The daemon runs on the machine that matters, so it samples that machine and the UI shows it at a glance.[^task-149]

# The sampler

`LoadSampler` measures the whole machine, not the daemon process. Each tick it sums every core's `os.cpus()` times (user, nice, sys, idle, irq) and reports the busy share of the change since the previous tick as `cpu`, 0 to 100 to one decimal. It also records `os.loadavg()` (1, 5 and 15 minutes, to two decimals) and the core count.[^sampler]

- **First reading.** `start()` takes a baseline and records nothing. The counters are cumulative since boot, so a figure from them alone would be the uptime average.
- **Unusable intervals.** If the counters ran backwards, no time passed, or the core count changed, that sample's `cpu` is `null` and the next interval is measured from the new reading.
- **Ring.** A fixed ring of 300 samples at 2 s, which is 10 minutes. `history()` returns a copy, oldest first.
- **Lifecycle.** One instance for the daemon, started at boot whatever the client count, so a page loaded at any time gets history. Its timer is `unref`'d, and `/api/shutdown` calls `loadSampler.stop()` beside `memorySampler.stop()`.[^server]

It is separate from `MemorySampler` (TASK-134), which samples the daemon's own footprint once a minute for the log. The two share a shape (start, stop, an injected clock) and nothing else.

A tick costs about 2 µs for `os.cpus()` and 1 µs for `os.loadavg()` under Bun on an M1 Max, measured over 1,000 calls. On that machine the 1-second deltas agreed with `top`'s idle figure within a few points.

# Delivery: pushed over the socket, not polled

The indicator is on screen in every client all the time, so a polled route would mean an HTTP request per client per tick, each through the origin guard and the compression wrapper. The terminal socket is already open. So:[^server][^types]

- **On open**, each socket is sent `loadHistory { intervalMs, capacity, samples }`, the whole ring (`sendLoadHistory`).
- **Each tick**, `streamLoad` hands `load { sample }` to `taskManager.broadcastToAll`, which serializes once and sends the same string to every socket. A client costs its frame and nothing else.

`wireLoadSampler` does both and is what `server.ts` and the socket test each mount. The test still cannot see whether `server.ts` calls `onOpen`, because importing `server.ts` bundles the frontend.

There is no HTTP route. The sampler reads the machine once per tick however many clients are connected, and a socket test pins that.

# In the browser

`TaskProvider`'s socket subscriber hands both frames to `systemLoad`, a module store read through `useSyncExternalStore`. It is not in context state, because a sample every 2 s would re-render everything under the provider. It is not component state either, because the history arrives once per connection and `TaskShell` remounts on every navigation. `loadHistory` replaces the store, `load` appends and trims to `capacity`, and a disconnect empties it, so a stale figure is never shown as live. A `load` stamped the same as the newest held sample is a repeat and is dropped. One stamped earlier means the daemon's clock stepped back, and the series restarts from it rather than freezing the meter until the clock catches up.[^store]

`components/SystemLoad.tsx` is the only reader. `TaskShell` passes it as `AppShell`'s `explorerRailFooter`, which `ExplorerRail` pins to its foot with `mt-auto`, so a tick re-renders the meter and not the shell.

# The indicator and the card

The indicator is a `role="meter"` with `tabIndex={0}` and no button, since there is nothing to press. It shows a 24×12 sparkline of the last 24 ticks and the whole-percent figure, or a dash before the first sample.[^indicator]

High load starts at 80% (`HIGH_LOAD`), compared on the figure as shown, so 79.6 (printed "80%") counts. It is signalled three ways, so colour is not the only one:

- the sparkline and its frame turn from `state-busy` and `border` to `warning`;
- the figure gets a 1px outline box and semibold weight;
- `aria-valuetext` reads "CPU 91%, high".

The card is a `HoverCardShell` opening left and bottom-aligned, off the rail into the pane. It contains:

- the heading, with the current figure;
- a 260×72 SVG of CPU over the window, with hairline gridlines at 0, 50 and 100% on a fixed scale, a 2px `state-busy` line over a 12% wash drawn with `fillOpacity` rather than a `color-mix` (see [color-mix over a var() renders opaque](/gotchas/color-mix-over-var.md)), and an end dot ringed in the pane colour;
- "10 min ago" and "now" under the chart;
- Peak, Load (1/5/15) and Cores facts.

The SVG's `aria-label` summarises low, peak and now. The peak and low, like the plot, are taken over the samples inside the window ending at the newest one (`inWindow`), because after a sleep the 300-sample ring reaches back further than 10 minutes. Two neighbouring samples more than 2.5 ticks apart are not joined, so a sleeping laptop shows as a gap. A `null` breaks the line the same way, and the end dot is drawn only when the newest reading is a number. The path arithmetic lives in `load-chart.ts`, apart from the components.[^chart]

The card opens on keyboard focus as well as hover. `HoverCardShell` gained `openOnFocus`, `side` and `align` props, with defaults that keep the task and commit cards as they were: a row's card still ignores focus (TASK-115).[^hovercard] There is no crosshair or tooltip inside the chart, because the shared panel is `pointer-events-none` and closes when the pointer leaves the trigger. Nothing animates, so there is nothing for reduced motion to stop.

# Limits

- **No card on touch devices.** `HoverCardShell` mounts no trigger when `useHoverPointer` is false, so a tablet or phone sees the figure and sparkline but has no way to reach the chart.
- **Linux is untested.** The same Node APIs read `/proc/stat` and `/proc/loadavg`, but nothing here was run on Linux. Two things are expected and unconfirmed. libuv's per-CPU times leave out iowait, softirq and steal, so time spent in those counts as neither busy nor idle. In a container, both figures describe the host, not the cgroup's CPU quota.
- **Host clock.** Sample times are the daemon's `Date.now()`, and the chart's right edge is the newest sample, not the browser's clock, so clock skew between the two does not move the line.

[^sampler]: src/lib/system-load.ts
[^types]: src/lib/xtmux/types.ts
[^server]: src/server.ts
[^store]: src/frontend/system-load-store.ts
[^indicator]: src/frontend/components/v2/SystemLoad.tsx
[^chart]: src/frontend/components/v2/load-chart.ts
[^hovercard]: src/frontend/components/v2/HoverCardParts.tsx
[^task-149]: TASK-149 System load indicator in the side rail with a load-over-time hover card
