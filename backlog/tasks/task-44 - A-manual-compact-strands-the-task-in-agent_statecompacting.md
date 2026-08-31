---
id: TASK-44
title: A manual /compact strands the task in agent_state=compacting
status: Done
assignee:
  - '@claude'
created_date: '2026-08-29 09:05'
updated_date: '2026-08-31 01:05'
labels:
  - server
  - agent
  - bug
dependencies: []
ordinal: 44000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by code review during TASK-14 (not introduced by it).

src/lib/agent/hook-state.ts:63 — the compact SessionStart declines to set a state so 'whatever state the turn was in survives'. But PreCompact has already replaced that state with 'compacting', so 'compacting' is what survives. After an auto-compact mid-turn the following Stop or UserPromptSubmit clears it; after a manual /compact typed at the prompt, nothing does, and the task shows as compacting for the rest of the session.

Telling the two apart needs PreCompact's trigger field ('manual' | 'auto'), which HookPayload does not currently model.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 HookPayload models PreCompact's trigger field
- [x] #2 A manual /compact returns the task to idle rather than leaving it compacting
- [x] #3 Auto-compact mid-turn still preserves the turn's state
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
HookPayload now models PreCompact's `trigger`. A compaction is two hooks and only the first names the trigger, so hook-state exports `compactTriggerOf` / `endsCompaction` and TaskManager holds the trigger between them in `compactTriggers` (in memory: it is live only for the seconds between the two, and a daemon restarting across that gap has killed the agent that would send the second half; dropped wherever hookSeen is). The compact SessionStart then resolves: auto → back to `busy` (mid-turn, Stop still to come), manual → `idle` with idle_since stamped. An unknown trigger keeps the old behaviour — claim liveness, claim nothing about state — rather than guessing. Note the manual case was also immortal to the harvester, which only collects `idle` tasks. §4.2's mapping table updated.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
PreCompact's trigger is now modelled and held across the compaction, so the SessionStart that ends one can tell the two kinds apart: auto hands the turn back as busy, manual returns the task to idle instead of stranding it in compacting (where it also stayed invisible to the harvester). An unknown trigger keeps the old make-no-claim behaviour. Verified with five new tests across hook-state.test.ts and manager.test.ts, plus the full suite.
<!-- SECTION:FINAL_SUMMARY:END -->
