---
id: TASK-18
title: 'layout-store: tab descriptors, groups, persistence'
status: Done
assignee: []
created_date: '2026-08-29 00:02'
updated_date: '2026-08-30 00:54'
labels:
  - frontend
milestone: m-3
dependencies: []
documentation:
  - docs/v2-architecture.md
priority: high
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
frontend/layout-store.ts (§7.2): TabDescriptor union (agent | shell | diff | diffAll | file | commit | history), `tabKey()` for dedupe/focus, TabState with preview flag, TabGroup { id, tabs, activeTabId, flex }, TaskLayout { groups, activeGroupId }. Flat row of groups, not a recursive grid. Persisted per task id in localStorage. Operations: open (dedupe via tabKey; preview replaces preview), pin, close, move between groups, split, reorder, focus.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 tabKey is stable for equal descriptors and distinct for different ones
- [x] #2 Opening a descriptor whose key is already open focuses the existing tab
- [x] #3 A single-click open creates a preview tab that the next preview open replaces; pin makes it permanent
- [x] #4 The agent tab always exists, is unique, and cannot be closed
- [x] #5 Split is refused for agent and shell tabs; a terminal never appears in two groups
- [x] #6 Layout round-trips through localStorage keyed by task id and survives reload
- [x] #7 Pure functions with unit tests for every operation
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Types (§7.2): TabDescriptor union, TabState { id, descriptor, key, preview }, TabGroup { id, tabs, activeTabId, flex }, TaskLayout { groups, activeGroupId }. TabState needs both id and key: split copies a read-only tab into a second group, so a key is not unique across the layout while an id must be.
2. tabKey(): kind-prefixed, with `file`'s optional `line` deliberately excluded so opening a file at a second line focuses the open tab and scrolls rather than opening a duplicate — which is the dedupe story §7.2 asks for.
3. Pure operations over a layout, each returning a new one: createLayout, openTab (dedupe by key, preview replaces preview), pinTab, closeTab, moveTab, splitTab, focusTab, setGroupFlex. Invariants enforced in one place: exactly one agent tab, never closable; split refused for agent and shell so a terminal is never in two groups; empty groups collapse except the last; activeGroupId/activeTabId always name something real.
4. Persistence per task id in localStorage under codetoaster:layout:<id>, with a revive that validates and falls back to a fresh layout rather than throwing on an older shape. Plus retainLayouts(validIds) mirroring retainViewStates.
5. pruneShellTabs(layout, livePtyIds) rather than dropping shell tabs on load: a page reload leaves the shell PTYs alive, only a harvest kills them, so the store stays pure and the caller supplies what is live.
6. Unit tests for every operation and every invariant (AC #7), including a localStorage round-trip and a malformed-payload fallback.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done. `frontend/layout-store.ts` plus 79 unit tests.

Three decisions the task did not specify:

- **`tabKey` excludes `file`'s `line`.** Go-to-definition on line 400 of a file already open at line 12 has to move the cursor, not open the file twice — which is the dedupe story §7.2 asks for. A re-open therefore always refreshes the descriptor, which is how the new line reaches the open tab, while `preview` only ever clears (a tab the user pinned must not go back to italic because they clicked its file in the tree again).
- **`TabState` carries both `id` and `key`.** Splitting a read-only tab puts the same descriptor, and so the same key, in two groups — §7.2's 'one file beside another' — so a key cannot be the identity that moves and closes name. `findByKey` prefers the active group when both copies exist.
- **Dead shell tabs are pruned by an explicit `pruneShellTabs(layout, livePtyIds)`, not on load.** A page reload leaves the task's shell PTYs running server-side; only a harvest or a daemon restart kills them (§3). The store cannot tell which happened, so the caller — which has just been told the task's live PTYs — supplies the answer, and the store stays pure.

`reviveLayout` is deliberately strict and re-mints ids rather than trusting them. A layout written by an older build is the normal case, not an exceptional one, and guessing at a half-understood shape costs a shell that throws on mount; anything that does not validate is discarded for a fresh layout. `storage()` tolerates localStorage being absent (test runner) or throwing (private window, blocked site data).

Verification beyond running the suite: mutation-tested five behaviours to check the tests have teeth. Making the agent tab closable, putting `line` back in `tabKey`, appending instead of replacing the preview tab, allowing split on terminals, and removing the agent-count guard each break the suite. One mutation survived — narrowing the agent guard from `!== 1` to `< 1` — which turned out to be correct: two agent tabs always share the key `agent`, so the duplicate-terminal-across-groups check below already rejects them. The guard's load-bearing half is the zero-agent case, and removing it entirely does fail a test.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Adds frontend/layout-store.ts: the §7.2 tab model as pure functions over a TaskLayout — TabDescriptor union, tabKey dedupe, preview tabs, a flat row of groups, and per-task localStorage persistence with a strict revive. No React, no server, so every rule is testable without mounting anything.

Verified with 79 unit tests covering every operation and invariant, and with mutation testing: five deliberate breakages, four caught, and the fifth shown to be a redundant guard rather than a gap. Full suite 556 pass / 0 fail, tsc clean.
<!-- SECTION:FINAL_SUMMARY:END -->
