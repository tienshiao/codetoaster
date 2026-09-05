---
id: TASK-88
title: Make harvest_after and the eviction grace configurable
status: To Do
assignee: []
created_date: '2026-09-05 09:31'
labels:
  - server
  - cli
dependencies: []
references:
  - src/lib/tasks/harvester.ts
  - src/index.ts
  - src/cli/commands.ts
  - README.md
documentation:
  - docs/v2-architecture.md
priority: medium
ordinal: 88000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The harvester suspends a live task after it has been idle with no views for harvest_after (default 30 min) and evicts a suspended task's checkout after a base grace of 7 days scaled by setup cost. Both have setters on Harvester (setHarvestAfter, setEvictAfter, 0 disables) but nothing outside the tests calls them, so a user gets the defaults and nothing else. TASK-37's README says so explicitly under 'Harvesting and eviction'.

Expose both through the daemon's own configuration surface: --harvest-after and --evict-after flags on the CLI (accepting a duration such as 30m, 2h, 7d, or 0), with CODETOASTER_HARVEST_AFTER / CODETOASTER_EVICT_AFTER env fallbacks so a launchd or systemd unit can set them without argv. Wire them through server start to the harvester before the first tick. The values are per daemon, not per project: the guards are about this machine's memory and disk. A settings-UI control can follow later; keep this to the CLI so the flag and its parsing can be tested without a browser.

Update the README's 'Neither is configurable yet' paragraph and the usage text in cmdHelp.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 codetoaster --harvest-after <duration> and --evict-after <duration> are accepted by both the daemon and foreground commands, parse m/h/d suffixes and 0, and reject anything else with a clear message
- [ ] #2 CODETOASTER_HARVEST_AFTER and CODETOASTER_EVICT_AFTER are honoured when the flag is absent, and the flag wins when both are set
- [ ] #3 The parsed values reach Harvester.setHarvestAfter / setEvictAfter before the first tick, with a unit test on the duration parser and one on the wiring
- [ ] #4 cmdHelp lists both flags and the README's Harvesting and eviction section documents them instead of saying they are not configurable
<!-- AC:END -->
