---
id: TASK-34
title: 'Keyboard shortcuts for tabs, splits, and groups'
status: Done
assignee:
  - '@claude'
created_date: '2026-08-29 00:03'
updated_date: '2026-09-05 00:22'
labels:
  - frontend
milestone: m-5
dependencies:
  - TASK-22
documentation:
  - docs/v2-architecture.md
ordinal: 34000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
§10 Phase 6: tab navigation (next/prev, jump to N), split, close tab, move focus between groups, focus the agent tab, new shell. Shortcuts must not steal keys the agent terminal needs while it is focused.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Documented shortcuts exist for next/prev tab, close tab, split, focus group left/right, focus agent tab, new shell
- [x] #2 Shortcuts do not fire while typing in a terminal unless they use a reserved modifier chord
- [x] #3 The keymap is a single exported table (id, label, chord, group) that both the dispatcher and the terminal's key handler read, so a new shortcut is one entry and no edit to Terminal.tsx
- [x] #4 Shortcuts are discoverable without the keyboard: the chords appear on the controls they drive
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Chord policy: a leader chord, then a key. Leader is ⌘K on macOS and ⌃⇧K elsewhere (⌃K is readline kill-line). Nothing in the map is a chord Chrome or a terminal already owns — Chrome holds every conventional next-tab chord (⌘1-9, ⌃Tab, ⌘⇧[/], ⌘⌥←/→) and, while all but ⌘W/⌘T/⌘N/⌘Q are preventDefault-able, taking them costs the user their browser while the app is focused.

  ⌘K ] / ⌘K [   next / previous tab
  ⌘K 1..9       jump to tab N
  ⌘K \          split
  ⌘K A          focus the agent tab
  ⌘K ← / →      focus group left / right
  ⌘K `          new shell
  ⌘K W          close tab

1. keymap.ts — the table. ShellCommand {id, label, chord, group}, SHELL_COMMANDS, isLeader(ev), matchCommand(ev), and one predicate the terminal asks. Invert Terminal.tsx:431-442, which today allowlists escapes by hardcoding one chord per if — a list that is v1's and names two surfaces that no longer exist (⌘⇧P's palette went with TASK-28, ⌃` was the v1 tab switcher). After this, a new shortcut is a table entry and Terminal.tsx is not touched again.
2. Pure layout reductions over TaskLayout: nextTab, prevTab, tabAt(n), focusGroup(dir), agentTab. layout-store already has openTab/closeTab/focusTab/splitTab/canSplit/moveTab/activeGroup/allTabs, so these are the last few and there is no new layout logic in this task.
3. useShellKeymap — a window keydown listener in capture phase, so it sees the key before xterm's textarea handler and stopPropagation keeps it off the PTY. Owns the leader-pending state: expires on a timeout, cancels on Escape. Mounted in TaskShell, which already holds applyLayout, handleNewShell and handleCloseTab.
4. Focus, which is the part that is not layout. Focus group / focus agent mean putting DOM focus into an xterm, and nothing outside Terminal.tsx can say so today (it focuses itself at :196 and :328). Thread a focus signal TabPane → AgentPane/ShellPane → Terminal.
5. Discoverability without the keyboard: KeyHint on the controls the chords drive.

Tests: 1, 2 and the leader state machine are pure → .test.ts. Focus-on-activate is a lifecycle question → .render.tsx. The chord policy itself gets checked in a browser via the verify skill, since happy-dom cannot tell us what Chrome actually lets us preventDefault.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Build against `frontend/components/v2/` — the v2 design system is the new UI, not a parallel track (CLAUDE.md, "The v2 design system is the new UI"). `AppShell` and the shell components already exist from TASK-46; this task supplies their data. Do not extend `components/ui/` (v1 shadcn) for new surfaces.

Slice 1 (f7f0f97): keymap.ts is the table — SHELL_COMMANDS, isLeader, matchCommand, terminalMustYield, and the KeyHint caps helpers. Leader is ⌘K / ⌃⇧K. Terminal.tsx's three hardcoded escapes are one terminalMustYield call; the two dead ones (⌘⇧P, ⌃`) are gone, and ⌘G stays because TerminalSearchBar listens on document in the bubble phase, after xterm. The leader map needs no terminal entry of its own — its listener will run on window in capture and stop propagation — but the leader itself is yielded anyway, so a disagreement between the two listeners costs a shortcut rather than typing a bare k into the agent. 25 tests, all green.

Slice 2 (9c87227): cycleTab / focusTabAt / focusGroup / findAgentTab in layout-store, beside the operations they compose. Tabs wrap, groups clamp.

Slice 3 (d999393): stepKeymap (pure) + useShellKeymap, mounted in TaskShell with the same handlers the tab strip's own controls get. Window listener in capture, so a consumed key never reaches xterm's textarea handler.

Two things the tests forced:
- The hook takes the layout as a getter, not a value. TaskShell passes () => layoutRef.current — the ref applyLayout already keeps current for handleNewShell's sake. Without it, two chords inside one React commit both reduce over the same starting layout and the second undoes the first.
- Shifted punctuation folds back (} → ], { → [, | → \\, ~ → `). The non-Mac leader is ⌃⇧K, so a held Shift is the normal case there, and without the fold every punctuation chord would be broken on that platform only.

Slice 4 (3f47c93): the caret follows a keyboard navigation. TaskShell counts a pulse the keymap raises, and hands it to the one pane that is both visible and in the active group — visible alone is per-group and true for both halves of a split. Only the keyboard raises it, and only when the reduction changed something, so a clamped ⌘K ← does not yank focus. ⌘K A always pulses: wanting the caret back on an agent tab already in front is most of what it is for.

Slice 5 (ba920e7, 62a0a28): chordHint on New shell, Split right and the active tab's X — tooltip only, not the accessible name. README's shortcut table rewritten; the old one named a palette and a tab switcher that went with TASK-28 and a Cmd+B that was never bound.

Verified in Chrome against a real instance on :4599, which is the half happy-dom cannot answer:
- ⌘K is delivered to the page and preventDefault holds (defaultPrevented true at a window-capture probe).
- ⌘K ] / [ / 2 / A / ← / → / \\ / ` / W all act, and nothing reaches the agent's prompt.
- ⌘K ⌘W — the second press with ⌘ still held, which is ⌘W to Chrome — closes the app's tab and does NOT close the browser tab. That was the open risk in the map, since ⌘W is otherwise unpreventable; with the leader armed it is ours.
- document.activeElement is the xterm textarea after ⌘K A and after ⌘K ← onto a group whose active tab is the agent.
- 'New shell (⌘K `)' is on the + button's title; Split carries none while disabled, as designed.

Final: bun run test — 1140 unit across 71 files, 221 render across 25, all green. tsc --noEmit clean.

Review follow-ups (2972a5f), two real bugs:

1. keymap.ts — a second leader press cancelled the arm instead of renewing it. The code comment and the test's own name both said 're-arms'; only the assertions said otherwise, so the test locked the bug in. ⌘K ⌘K ] left the ] unarmed and typed it into the agent.
2. TaskShell.tsx — the focus pulse was a monotonic counter delivered by position (visible && active group). A counter outlives the keystroke that raised it, so any later layout change that moved a terminal into the front slot re-delivered it: a tab click, ⌘K W closing the tab in front, §5.5's shell-tab prune, or a task switch remounting TabPane with the standing number. Filter the sidebar, click a task, keep typing — the characters went to the agent. Now addressed to the tab id the chord landed on (read off layoutRef, which applyLayout has already written), and the panes fire only on a rise from what they mounted with.

bun run test after: 1141 unit, 222 render, tsc clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Tab, split and group shortcuts under a leader chord — ⌘K on macOS, ⌃⇧K elsewhere — with the map as one exported table.

The chord family is the decision the task turned on. Chrome owns every conventional next-tab chord (⌘1-9, ⌃Tab, ⌘⇧[/], ⌘⌥←/→), and the agent below is a terminal that wants nearly every bare Ctrl chord; a leader takes nothing from either. ⌃⇧K off a Mac because ⌃K is readline kill-line.

keymap.ts holds the table, the leader state machine, and the predicate the terminal asks — so a new shortcut is an entry there and Terminal.tsx is not touched. It previously allowlisted escapes one hardcoded chord per if, two of them naming surfaces gone since TASK-28. layout-store gained cycleTab / focusTabAt / focusGroup / findAgentTab beside the operations they compose; tabs wrap, groups clamp. useShellKeymap binds it on window in the capture phase, so a consumed key never reaches xterm's textarea handler. The caret follows a navigation into the pane that lands in front.

Two things the tests forced: the hook reads the layout through a getter (TaskShell's existing layoutRef), so two chords inside one React commit compose rather than the second undoing the first; and shifted punctuation folds back onto the cap the table names, since the non-Mac leader is ⌃⇧K and a held Shift sends } for ].

AC #3 moved to TASK-35 — CommandPalette.tsx went with the v1 scaffolding in TASK-28, so there was no palette to list into. The table is shaped {id, label, chord, group} for it to consume. Discoverability meanwhile is the chord on the tooltip of the control that does the same thing.

Verified: bun run test (1140 unit + 221 render, green), tsc clean, and every chord driven in a real Chrome against an instance on :4599 — including ⌘K ⌘W, the second press with ⌘ still held, which closes the app's tab without Chrome taking it.
<!-- SECTION:FINAL_SUMMARY:END -->
