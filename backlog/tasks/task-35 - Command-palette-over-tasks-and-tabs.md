---
id: TASK-35
title: Command palette over tasks and tabs
status: Done
assignee:
  - '@claude'
created_date: '2026-08-29 00:03'
updated_date: '2026-09-05 02:29'
labels:
  - frontend
milestone: m-5
dependencies:
  - TASK-25
  - TASK-22
documentation:
  - docs/v2-architecture.md
ordinal: 35000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rewrite CommandPalette.tsx to be task-oriented (§8): jump to a task (with state dots), open/focus a tab in the current task, new task, new shell, close/resume/archive current task, split, toggle sidebars.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Palette lists tasks with agent-state indicators and navigates on select
- [x] #2 Palette lists open tabs and the Explorer's openable items for the current task
- [x] #3 Task actions (new, close, resume, archive) and layout actions (split, toggle sidebars) are available
- [x] #4 The palette lists the shell commands from keymap.ts's SHELL_COMMANDS with their chords (moved from TASK-34 AC 3, which had no palette to list into)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. keymap.ts: a *direct* chord row — {id:'palette', command:'palette', group:'View', key:'p', direct:true} — fired as ⌘⇧P on macOS / ⌃⇧P elsewhere (the design's CommandPalette.prompt.md says ⌘⇧P; ⌘K is the leader since TASK-34). stepKeymap returns it when not armed; matchCommand ignores direct rows so ⌘K P is still 'cancelled'; terminalMustYield includes it; chordCaps/chordHint render ⌘ ⇧ P / Ctrl ⇧ P. Tests in keymap.test.ts.
2. use-shell-keymap: returns { run } so the palette dispatches SHELL_COMMANDS through the same handlers the chords use; new onTogglePalette option answers 'palette'. Render test: ⌘⇧P consumed and toggles.
3. AppShell: controlled sidebarOpen/onSidebarOpenChange mirroring the Explorer's pair, and FilterInput's hint turned back on with capsFor('palette').
4. palette-items.ts (pure, bun test): tasks → rows with taskStateOf dot + project detail + current marker; layout → open-tab rows via presentTab/TAB_KINDS; actions → New task, New shell, Close task, Resume (only suspended/could_not_resume), Archive, Split (only canSplit), Toggle task list, Toggle Explorer, plus every SHELL_COMMAND with its caps (jump-tab pruned to the active group's tab count; the palette row itself excluded).
5. components/v2/CommandPalette.tsx: the design's overlay built on cmdk (already a dependency, unused since TASK-28) — portal + scrim like v2/Dialog, Escape closes, first row preselected, groups/rows/KeyHint/StatusDot per the design file. Presentational: groups in, onSelect out.
6. components/CommandPalette.tsx host in TaskShell: gathers useTasks/useTaskDiff/useGitLog/useGitRefs/useFileSearch(debounced, forceMount rows), builds groups Open tabs / Tasks / Actions / Changes / History / Refs / Files, runs selections (openTask, focusTab + focus pulse, openTab, run(command), closeTask with the busy confirm, archive via the dialog extracted from TaskSidebar, resumeTask). Escape/scrim restore focus to where it was; a selection does not.
7. README shortcut row, __root.tsx comment, verify in Chrome, bun run test + tsc.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Build against `frontend/components/v2/` — the v2 design system is the new UI, not a parallel track (CLAUDE.md, "The v2 design system is the new UI"). `AppShell` and the shell components already exist from TASK-46; this task supplies their data. Do not extend `components/ui/` (v1 shadcn) for new surfaces.

Nothing binds ⌘K any more. TASK-21's S4 deleted the v1 CommandPalette (it was typed off the session routes), and AppShell's FilterInput now passes shortcut={null} so the sidebar stops advertising a key hint with nothing behind it. Turn it back on here.

Chord: ⌘⇧P / Ctrl+Shift+P, per the design project's overlays/CommandPalette.prompt.md. The task's older note said ⌘K, which TASK-34 has since made the leader; the palette is the thing that lists the leader's chords, so it is the one `direct` row in SHELL_COMMANDS (keymap.ts), matched only while no leader is armed. ⌘K P is still 'cancelled'.

Three commits: the keymap's direct row and useShellKeymap returning its dispatcher; components/v2/CommandPalette over cmdk (already a dependency, orphaned since TASK-28; Command.Dialog is not used — the overlay is Dialog.tsx's shape) plus palette-items.ts, the pure row builders with their actions; and the host in components/CommandPalette.tsx, a sibling of TaskShell.

Decisions worth knowing:
- cmdk scores each row's label/detail/keywords, not its value: the value is an id, and 'task' would match every task:<uuid>.
- Server-filtered file rows are forceMount, and so is their group; a group is therefore wholly server-filtered or wholly cmdk-filtered, never mixed (comment in the component).
- History and Refs rows exist only once something is typed — at an empty box they are lists, not answers, and would bury the actions. Changes are always listed; Files come from /files/search, debounced 200ms.
- Tab rows put the strip's tooltip in the detail slot only for file/diff/commit tabs, where it is a path or sha; the fixed tabs' prose titles read as identifiers there and are dropped.
- A dismissal (Escape, scrim) restores focus to where it was; a selection does not — a tab selection raises the shell's focus pulse, a task jump navigates away.
- Close task confirms when the agent is busy, as the row's X does; Archive opens the same ArchiveTaskDialog, extracted from TaskRowActions.
- Resume appears for a suspended task or a could_not_resume one; the palette calls resumeTask without a grid, so the default reporting toasts a failure.
- Backlog items are not listed; Remotes are skipped in Refs (they double the list).

Verified in Chrome on :4599: the hint in the sidebar filter reads ⌘⇧P; at the composer the palette offers tasks + New task + the two toggles; on a task it lists Open tabs, Tasks (current marked), Actions with chords, Changes; 'keymap' finds changes and files with matched characters set apart; 'TASK-34' finds commits; New shell via the palette opens a shell tab; selecting the Agent tab lands the caret in xterm; Escape returns focus to xterm; a task row navigates; Archive opens the preview dialog; Toggle task list hides the sidebar and the strip's own button still brings it back.

bun run test: 1173 unit across 72 files, 238 render across 26. tsc clean.

Review follow-ups (/code-review --fix), four commits:
- Host keyed by task, so a Close/Archive confirmation cannot outlive the task it was opened on.
- History/Refs/Files groups built only while there is a query: react-query's cache (and keepPreviousData) survived the `enabled` gate.
- Focus restored on unmount when nothing else took it — the ⌘⇧P toggle and focus-neutral selections used to leave the caret on body.
- Palette's sidebar toggle shares the strip's mobile rule (close the Explorer first).
- The focus pulse now reaches diff/file/commit/history panes through a focusable frame (use-focus-request.ts); only the focused strip names close/split chords.
- commandAvailable() in layout-store is the one predicate for jump/split/close, used by the dispatcher and the palette alike.
- ⇧⌘G in TerminalSearchBar matched raw 'g' and never fired; it binds with keymap's isSearchChord now.
- bg-scrim token replaces three black literals.

Not taken: the reviewer's claim that ⌘K W with ⌘ still held closes the browser tab — TASK-34 verified in Chrome that with the leader armed it does not. Also left as designed: the leader map staying live while the palette is open.

After: 1177 unit, 239 render, tsc clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A task-oriented command palette on ⌘⇧P / Ctrl+Shift+P, built from the v2 design system's CommandPalette spec over cmdk.

It lists tasks with agent-state dots (current marked), the current task's open tabs, the task and layout actions, every SHELL_COMMAND with its chord, and the Explorer's changes, commits, refs and files; every selection runs through the door that already exists for it — useOpenTask, the layout's focusTab plus the focus pulse, openTab, useShellKeymap's dispatcher, and the sidebar's close/archive rules and dialogs.

The chord is the one direct row in keymap.ts: the palette lists the leader's chords, so it cannot itself be behind the leader. Verified in Chrome against a real instance and by bun run test (1173 unit, 238 render) with tsc clean.
<!-- SECTION:FINAL_SUMMARY:END -->
