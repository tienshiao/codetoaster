---
id: TASK-88
title: Make harvest_after and the eviction grace configurable
status: Done
assignee:
  - '@claude'
created_date: '2026-09-05 09:31'
updated_date: '2026-09-05 20:58'
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
- [x] #1 codetoaster --harvest-after <duration> and --evict-after <duration> are accepted by both the daemon and foreground commands, parse m/h/d suffixes and 0, and reject anything else with a clear message
- [x] #2 CODETOASTER_HARVEST_AFTER and CODETOASTER_EVICT_AFTER are honoured when the flag is absent, and the flag wins when both are set
- [x] #3 The parsed values reach Harvester.setHarvestAfter / setEvictAfter before the first tick, with a unit test on the duration parser and one on the wiring
- [x] #4 cmdHelp lists both flags and the README's Harvesting and eviction section documents them instead of saying they are not configurable
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. src/cli/duration.ts: parseDuration (0 or an integer with an m/h/d suffix, anything else is an error naming the accepted forms), formatDuration (the canonical Nm/Nh/Nd/0 spelling so the daemon argv round-trips exactly), resolveDuration(flag, env, names) where the flag wins and a flag given no value is an error. duration.test.ts covers all three.
2. Options object instead of a fifth and sixth positional: ServerOptions gains harvestAfterMs and evictAfterMs; cmdStart, cmdForeground and spawnDaemon take one DaemonOptions (ServerOptions with port required); index.ts resolves both durations once, flag over CODETOASTER_HARVEST_AFTER / CODETOASTER_EVICT_AFTER, and exits 1 with the message on a bad one before anything is spawned.
3. spawnDaemon's flag list is extracted to a pure daemonArgs(options) that passes --harvest-after / --evict-after through formatDuration, unit-tested.
4. server.ts applies setHarvestAfter / setEvictAfter before harvester.start() and logs the effective values when either is overridden; Harvester gets read-only getters for both. start.test.ts gains the wiring tests against the real CLI: foreground --port 0 with both flags logs the values; env alone is honoured; the flag beats the env; a bad value exits 1 naming the flag or variable.
5. cmdHelp and README (Options table and the Harvesting and eviction section) document both flags and both variables; tsc and bun run test clean.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Landed as planned. duration.ts holds the parser (0, or an integer with m/h/d), the canonical formatter the daemon argv round-trips through, and resolveDuration (flag over env; a flag with no value and an empty env are handled). cmdStart/cmdForeground/spawnDaemon take one DaemonOptions object; daemonArgs is the pure respawn list. server.ts applies both setters before the first tick and logs the effective pair when either was given. Deviations from the plan: daemonArgs tests live in duration.test.ts, and help/README use two lines per flag. Validation: tsc clean; bun run test:unit 1241 pass / 0 fail (+32); test:render 268 pass.

Review pass (recall, --fix): durations now resolve only for start/foreground so a bad env var no longer breaks stop/list/help; daemonArgs always spells --port so an inherited PORT cannot redirect the respawn; parseDuration rejects values past the safe-integer range (Infinity/exponent round-trip); Harvester takes both windows as constructor options; cmdStart notes when flags are ignored on an already-running daemon; help/README say 'base grace' for --evict-after and document that both-off also parks the worktree-status refresh; start.test.ts scrubs the two env vars from the child and uses one timer instead of a race per chunk. tsc clean; 1244 unit / 268 render pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
harvest_after and the eviction grace are configurable per daemon: --harvest-after and --evict-after (0, or an integer with m/h/d) on both start and foreground, with CODETOASTER_HARVEST_AFTER / CODETOASTER_EVICT_AFTER as fallbacks; the flag wins, a bad value exits 1 naming its source before any daemon is spawned, and the background daemon re-spells the values onto its child's argv. The server applies both to the harvester before its first tick and logs the effective pair. cmdHelp and the README document both. Verified with duration and daemonArgs unit tests, five end-to-end CLI tests, tsc, and the full suite.
<!-- SECTION:FINAL_SUMMARY:END -->
