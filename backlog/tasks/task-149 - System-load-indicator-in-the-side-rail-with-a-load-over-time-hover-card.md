---
id: TASK-149
title: System load indicator in the side rail with a load-over-time hover card
status: Done
assignee:
  - '@claude'
created_date: '2026-11-23T02:03:00Z'
updated_date: '2026-11-23T04:18:00Z'
labels:
  - frontend
  - backend
dependencies: []
references:
  - src/frontend/components/v2/ExplorerRail.tsx
  - src/frontend/components/v2/HoverCardParts.tsx
  - src/api/diagnostics.ts
ordinal: 152000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Working locally, the user keeps Activity Monitor open with its CPU load graph, so they always have a sense of how hard the machine is working while agents run. Using CodeToaster remotely there is no such view: running top or htop in a terminal tab takes a tab, has to be looked at on purpose, and shows only the present moment, not the trend. The daemon runs on the machine that matters, so it can sample machine-wide load itself and the UI can show it at a glance. The request is a small always-visible indicator at the bottom of the right side rail (ExplorerRail) and, on hover, a card with a chart of load over time. Existing pieces to look at: the hover card built for task rows (TASK-97, HoverCardParts) and the daemon diagnostics sampler (TASK-134, src/lib/diagnostics.ts, /api/diagnostics), which samples the daemon process, not the machine.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The bottom of the right side rail shows a compact, always-visible indicator of current machine-wide CPU load that updates live without a reload
- [x] #2 Hovering (or focusing) the indicator opens a card with a chart of load over a recent window (on the order of minutes), plus the current values and core count, and the 1/5/15-minute load averages
- [x] #3 The chart already has history when the card first opens after a page load: the daemon keeps a bounded rolling history rather than the browser starting from empty
- [x] #4 Sampling is cheap and bounded (fixed interval, fixed-size history) and costs nothing extra per connected client beyond receiving the values
- [ ] #5 Load is the whole machine the daemon runs on, not the daemon process, and works on macOS and Linux
- [x] #6 Colours come from v2 semantic tokens, the indicator and chart read in light and dark themes, and the indicator signals high load (e.g. a threshold colour) without relying on colour alone
- [x] #7 Any new or changed API route has route-level tests through a real Bun.serve on port 0; the sampler has unit tests with an injected clock; the indicator and card have rendering tests
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Sampler (src/lib/system-load.ts): LoadSampler reads os.cpus() and os.loadavg() (injectable, plus now) every 2s; CPU% = 1 - dIdle/dTotal over all cores between ticks (first tick is the baseline; a negative/zero delta or a core-count change records cpu null and rebaselines); bounded ring of 300 samples = 10 min; start/stop/subscribe; samples carry at, cpu (1 dp), load 1/5/15 (2 dp), cores. Runs from boot whatever the client count, so a page load gets history (AC3). 2. Delivery over the existing WebSocket, not a polled route: the indicator is always on screen in every client, so polling would be one HTTP request per client per tick through guard+compression, while the socket is already open; a push costs one JSON.stringify per tick (broadcastToAll) and a frame per client. Messages: loadHistory {intervalMs, capacity, samples} sent in open(ws), and load {sample} broadcast per tick. Helpers sendLoadHistory/streamLoad in system-load.ts so server.ts only wires them (4 small edits: construct+start, open, shutdown stop). 3. Frontend store (src/frontend/system-load-store.ts, useSyncExternalStore) fed from TaskProvider's existing subscriber; replace on history, append+trim on sample, reset on disconnect. A small host component reads it so only the indicator re-renders every 2s, passed to AppShell as a new explorerRailFooter slot -> ExplorerRail footer (mt-auto). 4. v2 components: SystemLoadIndicator (role=meter, tabIndex 0, sparkline of last ~24 samples + percent text; high load >=80% adds a bordered bold chip + aria-valuetext 'high' so it is not colour-only; tokens state-busy normal / warning high) and SystemLoadCard (SVG area+line chart of CPU over the window with hairline 0/50/100 grid, gaps broken where samples are missing, end dot; facts CPU now, peak, cores, load 1/5/15). HoverCardShell gains side/align/openOnFocus props (defaults unchanged) so this card opens on focus and to the left of the rail. Pure path math in a .ts with unit tests. 5. Tests: sampler unit (delta math, ring bound, start/stop, rebaseline), socket test via real Bun.serve (history on connect, one read per tick with 2 clients, broadcast), store unit, render tests (indicator values/high state, card opens on hover and focus with chart+numbers). 6. Smoke on port 4606, wiki page + index + log, /code-review high v2, notes.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Delivery: pushed over the terminal WebSocket, no HTTP route. The indicator is on screen in every client always, so polling would be one guarded+compressed request per client per tick; the socket is already open. loadHistory {intervalMs, capacity, samples} goes to each socket in open(); each tick streamLoad hands load {sample} to taskManager.broadcastToAll (one JSON.stringify per tick, one frame per client). Sampler (src/lib/system-load.ts): one instance from boot, 2s interval, 300-sample ring (10 min), baseline-first, cpu null on backwards counters / zero delta / core-count change; stopped in /api/shutdown beside memorySampler. Probe (Bun 1.4.4, macOS, M1 Max, 10 cores): os.cpus() ~2us/call, os.loadavg() ~1us; 1s deltas summed ~10000ms across 10 cores and busy% (42-50%) agreed with top's idle within a few points. Absolute idle counters on core 0 look odd under Bun (user 831M vs idle 50M ms) but deltas are sane, which is all the sampler uses. Linux not run: same APIs read /proc/stat; libuv omits iowait/softirq/steal from times, and in a container both figures are host-wide (unverified). Browser: TaskProvider's subscriber feeds a module store (useSyncExternalStore) so a tick re-renders only the meter; reset on disconnect. UI: ExplorerRail footer slot via AppShell explorerRailFooter; v2 SystemLoadIndicator is role=meter tabIndex 0 with a 24x12 sparkline + percent; high (>=80%) adds outline box + semibold + aria-valuetext ', high' + warning tone. Card: 260x72 SVG, fixed 0-100 scale, hairline grid, 2px state-busy line, 12% wash via fillOpacity (no color-mix), gaps >2.5 ticks and nulls break the line; Peak/Load 1,5,15/Cores facts. HoverCardShell gained openOnFocus/side/align (defaults unchanged, TASK-115 behaviour kept for rows). No in-chart crosshair: the shared panel is pointer-events-none. Known gap: touch devices get no card (HoverCardShell mounts no trigger without a hover pointer). No new tokens. Smoke on port 4606: loadHistory arrived at +1ms with 3 samples, then load frames at 2s spacing; /api/shutdown exited 0.

Review (/code-review high v2): 6 findings, all fixed in the fix commit. (1) Store dropped every load frame after a daemon clock step-back, freezing the meter: an earlier-stamped sample now restarts the series; only equal stamps are dropped. (2) Card Peak and chart aria-label low/peak were taken over the whole ring, which after a sleep reaches past the 10-min window: now over inWindow(samples). (3) isHighLoad compared the raw value while the label rounds, so 79.6 showed 80% unmarked: compares the rounded figure. (4) Doc comment said the sparkline frame turns warning; it now does. (5) Bare Bun.sleep in two sampler tests replaced with waitFor. (6) Socket test rebuilt the server.ts wiring by hand: both now mount wireLoadSampler; the test still cannot see server.ts calling onOpen (importing server.ts bundles the frontend), noted in the wiki.

Post-fix smoke on 4606 (HEAD 45d9818 wiring): loadHistory at +1ms (2 samples), load frames ~2s apart, /api/shutdown exited 0. Unit suite post-fix: 2262 pass, 1 fail twice, both the known TASK-151 manager.test.ts flake (an exiting terminal marks the task exited and sends the row); pre-fix run was 2261/0. Render suite 643/643. Not verified visually (left to main): 100% plus outline fitting the 36px rail, card placement at the bottom edge, wash and tones in dark mode.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The bottom of the right rail shows a live machine-wide CPU meter (role=meter, a 24x12 sparkline of the last ~48s above the whole-percent figure), and hovering or focusing it opens a card with a 10-minute chart on a fixed 0-100% scale, current CPU, peak over the plotted window, 1/5/15 load averages and core count. A single daemon-wide sampler (src/lib/system-load.ts) ticks every 2s into a 300-sample ring, deriving CPU % from os.cpus() time deltas and reading os.loadavg(); each socket gets a loadHistory frame on open and every tick is one load frame through broadcastToAll, so cost is independent of client count (pinned by a 3-client socket test); it stops on /api/shutdown. No HTTP route was added. High load (>= 80% on the shown figure) turns the sparkline and frame warning and adds an outline, bold weight and ', high' in aria-valuetext. Semantic tokens only (state-busy, warning). Verified in Chrome on an isolated server: the meter updates live, the card opens on hover and on keyboard focus, light and dark both read, and under a 12-process CPU saturation the meter showed an amber outlined 100% that fits the 35px rail and the card read '100% CPU - high'. Code review high: 6 findings, all fixed (clock step-back, peak over the plotted window only, rounding vs the high threshold, sparkline frame colour, bare sleeps, shared wireLoadSampler). AC 5 is left unchecked: macOS was verified against top, Linux was not run; expected caveats are that iowait/softirq/steal handling follows os.cpus() and that inside a container the figures describe the host. Also open: touch devices see the meter but cannot open the card; the card's chart line stays state-busy at high load. Typecheck clean, test:render 643/643, test:unit clean apart from the TASK-151 flake.
<!-- SECTION:FINAL_SUMMARY:END -->
