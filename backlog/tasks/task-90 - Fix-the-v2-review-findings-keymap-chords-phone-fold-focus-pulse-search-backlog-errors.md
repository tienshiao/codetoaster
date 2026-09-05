---
id: TASK-90
title: >-
  Fix the v2 review findings: keymap chords, phone fold, focus pulse, search,
  backlog errors
status: Done
assignee:
  - '@claude'
created_date: '2026-09-05 18:32'
updated_date: '2026-09-05 18:53'
labels: []
dependencies: []
ordinal: 90000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A code review of the v2 branch found thirteen correctness bugs in the shell's keyboard map, the phone layout fold, the focus pulse, terminal search, the command palette and the Backlog section. This task fixes all of them together because they share files and tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The close-tab and new-shell chords no longer resolve to a browser-owned accelerator (⌘W / Ctrl+Shift+W, ⌘`) when the leader's modifier is still held
- [x] #2 Jump-tab chords work on Windows/Linux with Shift still held from the ⌃⇧K leader (shifted digits are folded back)
- [x] #3 While a modal (Dialog or command palette) is open the leader does not arm, so Escape reaches the modal and typed characters are not eaten
- [x] #4 Shrinking the viewport under the breakpoint and widening it again restores the stored split; the fold is a projection, not a rewrite
- [x] #5 Automatic layout writes on a phone (shell-tab prune, ?tab= links, Explorer opens) and focus-only gestures do not persist the fold over the stored desktop split
- [x] #6 mergeGroups keeps the group holding the most terminal panes so a fold does not remount a shell dragged into another group
- [x] #7 Keyboard navigation onto a diff/file/commit/history tab focuses the freshly mounted pane
- [x] #8 ⌘G / ⇧⌘G step the active pane's matches from anywhere in the page while its search bar is open
- [x] #9 The terminal yields Ctrl+G to the search bar only while a search bar is open, so readline's ^G reaches the PTY otherwise
- [x] #10 Focus group left/right and next/prev tab are not offered when they cannot move
- [x] #11 The palette never draws file rows for a previous query as a selectable Enter target
- [x] #12 A persistently failing backlog poll is surfaced with a Retry affordance even while stale data is on screen
- [x] #13 bun run test passes and tsc is clean
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. keymap.ts: rebind close-tab to X and new-shell to S, fold shifted digits (ev.code first, US map second), add a modal flag to stepKeymap, gate terminalMustYield's search chord on searchOpen.
2. use-shell-keymap.ts: do not arm the leader while an aria-modal surface is open.
3. layout-store.ts: mergeGroups keeps the group with the most terminal panes; commandAvailable refuses next/prev-tab with one tab and focus-group with one group; add differsOnlyInFocus.
4. use-task-layout.ts: hold the stored layout and project the fold for display; re-project when singleGroup flips; setLayout rebases focus-only edits onto the stored layout; new editLayout applies a reducer to the stored layout for the shell's own edits (prune, ?tab=, Explorer opens, new shell, review submit).
5. use-focus-request.ts + TaskShell: a pulse lives one commit (the shell clears it after delivery), so a pane mounted by the pulse's own commit fires.
6. TerminalSearchBar: document-level ⌘G answered by the pane that has focus, else the active group's; Terminal.tsx gets searchOpen; panes carry data-terminal-pane and an active prop.
7. CommandPalette: aria-modal on the palette; drop keepPreviousData from useFileSearch.
8. BacklogSection: surface a persistent error with Retry above the stale list.
9. Tests for each, bun run test and tsc clean.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Core slices landed: keymap rebinds (close-tab X, new-shell S), shifted-digit fold via ev.code + US map, stepKeymap modal flag and the aria-modal gate in use-shell-keymap, mergeGroups keeper by terminal count, commandAvailable gating for next/prev/focus-group, differsOnlyInFocus, use-task-layout stored/shown projection with editLayout, one-commit pulses in TaskShell + usePulse mount rule. README shortcut table updated. Remaining slices (search bar document fallback, Terminal searchOpen, palette aria-modal, file-search placeholder, BacklogSection error note) delegated.

Validation: bunx tsc --noEmit clean; bun run test:unit 1209 pass / 0 fail; bun run test:render 268 pass across 27 files. The type errors the editor reported (searchRequest on TabPane, probe.render.tsx, missing modules) were stale diagnostics from the reviewer's throwaway harness; the file does not exist and tsc was clean before any change.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed all thirteen v2 review findings. Keymap: close-tab is ⌘K X and new-shell is ⌘K S (⌘W/⌘` were browser-owned), shifted digits fold via ev.code and a US map so ⌃⇧K 1 works off a Mac, stepKeymap takes a modal flag and use-shell-keymap stands down while an aria-modal surface is open. Layout: useTaskLayout holds the stored layout and shows a fold as a projection (widening restores the split), editLayout applies the shell's own edits (prune, ?tab=, Explorer opens, new shell, review submit) to the stored split, focus-only phone gestures are rebased by tab id; mergeGroups keeps the group with the most terminals; commandAvailable hides next/prev-tab and focus-group rows that cannot move. Focus: pulses live one commit (TaskShell clears them) so a freshly mounted diff/file pane takes the caret. Search: ⌘G is heard on the document and answered by the pane with the caret, else the active group's; the terminal yields ⌃G only while its bar is open. Palette: aria-modal declared; file rows never draw for a previous query. Backlog: a persistent poll failure shows a Retry note above the stale list. README shortcut table updated. Verified with tsc and the full bun/vitest suites.
<!-- SECTION:FINAL_SUMMARY:END -->
