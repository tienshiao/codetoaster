---
id: TASK-37
title: README for v2
status: Done
assignee:
  - '@claude'
created_date: '2026-08-29 00:03'
updated_date: '2026-09-05 08:33'
labels:
  - docs
milestone: m-5
dependencies:
  - TASK-28
  - TASK-30
documentation:
  - docs/v2-architecture.md
ordinal: 37000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rewrite the README for the cattle model: what a task is, the composer, resume/suspend semantics, worktrees, the codetoaster hook subcommand and why it must stay silent, harvest_after configuration, and the daemon-from-inside-an-agent caveat (§4.1).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 README describes tasks, suspend/resume, archive, and worktrees
- [x] #2 README documents harvest_after and the hook subcommand
- [x] #3 README warns about starting the daemon from inside a Claude Code session
- [x] #4 docs/v2-architecture.md status line is updated from 'design draft' to reflect what shipped
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Sources: docs/v2-architecture.md §1-§7, cli/commands.ts cmdHelp, cli/hook.ts, lib/tasks/harvester.ts, frontend/keymap.ts, Composer.tsx, AppShell.tsx.
2. Finding: harvester.setHarvestAfter/setEvictAfter are never called outside tests — there is no flag, env var or settings UI. The README documents the defaults (30 min idle harvest, 7 day evict, 0 disables) and says plainly they are not yet configurable rather than inventing a knob.
3. Rewrite README: pitch, screenshots, how it works (tasks, composer, live/suspended/archived, worktrees), features from the v2 shell, upgrading from v1 (fold in TASK-36's note), getting started, CLI from the real help text, agent integration (hook subcommand and its three hard properties, harvesting and eviction, the daemon-from-inside-an-agent warning), tech stack. Replace the v1 shortcut table with keymap.ts's bindings; fix the stale command palette note.
4. docs/v2-architecture.md status line: from 'design draft' to shipped on v2, kept as the design record.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Every command, flag, chord, path and lifecycle claim was checked against the code: cmdHelp, keymap.ts (leader ⌘K/⌃⇧K, 3 s window, chord table), lib/agent/settings.ts (six events, merge), harvester.ts (30 min, 0 disables, 7 day evict scaled to 4×, pinned exempt), manager.ts (archive never proceeds without a WIP snapshot; branch kept unless merged or on a remote), cli/hook.ts (silent, exit 0, 1 s budget). The one carried-over claim not re-counted is '100+ colour schemes' from the xterm-theme package.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
README rewritten for the task model: tasks and the composer, live/suspended/archived with resume semantics, worktrees with evict and WIP snapshots, the v2 shell's features and real keyboard chords, the CLI from the actual help text, the hook subcommand and its three hard properties, harvesting and eviction defaults (honestly noted as not yet configurable), and a prominent warning against starting the daemon from inside a Claude Code session. docs/v2-architecture.md status line now says phases 0–6 shipped on v2 and the document is the design record.
<!-- SECTION:FINAL_SUMMARY:END -->
