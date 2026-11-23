---
id: TASK-149
title: System load indicator in the side rail with a load-over-time hover card
status: To Do
assignee: []
created_date: '2026-11-23T02:03:00Z'
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
- [ ] #1 The bottom of the right side rail shows a compact, always-visible indicator of current machine-wide CPU load that updates live without a reload
- [ ] #2 Hovering (or focusing) the indicator opens a card with a chart of load over a recent window (on the order of minutes), plus the current values and core count, and the 1/5/15-minute load averages
- [ ] #3 The chart already has history when the card first opens after a page load: the daemon keeps a bounded rolling history rather than the browser starting from empty
- [ ] #4 Sampling is cheap and bounded (fixed interval, fixed-size history) and costs nothing extra per connected client beyond receiving the values
- [ ] #5 Load is the whole machine the daemon runs on, not the daemon process, and works on macOS and Linux
- [ ] #6 Colours come from v2 semantic tokens, the indicator and chart read in light and dark themes, and the indicator signals high load (e.g. a threshold colour) without relying on colour alone
- [ ] #7 Any new or changed API route has route-level tests through a real Bun.serve on port 0; the sampler has unit tests with an injected clock; the indicator and card have rendering tests
<!-- AC:END -->
