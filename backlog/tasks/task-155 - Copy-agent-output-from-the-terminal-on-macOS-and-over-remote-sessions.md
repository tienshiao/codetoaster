---
id: TASK-155
title: Copy agent output from the terminal on macOS and over remote sessions
status: Done
assignee:
  - '@claude'
created_date: '2026-11-24T10:12:00Z'
updated_date: '2026-11-24T10:35:00Z'
labels:
  - frontend
  - terminal
dependencies: []
ordinal: 158000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On a Mac there is no way to copy text out of a terminal tab while the program running there (Claude Code) has mouse reporting on. A plain drag goes to the program; xterm.js forces a selection with Option-drag on macOS only when `macOptionClickForcesSelection` is set, and it was not. When the program does its own selection and copies through OSC 52, xterm.js drops the sequence because no handler is registered, so the copy only works when the program can reach the clipboard of the machine the browser runs on, which is never the case when the daemon is remote. A program must not be able to read the clipboard through OSC 52, and only the server answers terminal queries.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Option-drag in a terminal tab on macOS selects text while the program has mouse reporting on, and Cmd-C copies it
- [x] #2 An OSC 52 write from the PTY puts the decoded UTF-8 text on the browser clipboard when the page is a secure context
- [x] #3 An OSC 52 read request is not answered by the browser terminal
- [x] #4 Malformed OSC 52 payloads and clipboard API failures are ignored without breaking the terminal
- [x] #5 Unit tests cover the OSC 52 parsing and the handler
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Terminal.tsx sets macOptionClickForcesSelection and altClickMovesCursor per mousedown (capture phase) from term.modes.mouseTrackingMode via optionClickOptions: forced selection and no Option-click cursor moves only while the program tracks the mouse, xterm defaults otherwise. 2. utils/terminal-clipboard.ts: parseOsc52Write (write only; reads, empty and bad base64/UTF-8 ignored) and handleOsc52Clipboard with an injected writer and an accepts predicate. 3. Terminal.tsx wires a navigator.clipboard writer with errors swallowed, accepted only in a focused window with the terminal on screen. 4. Unit tests against @xterm/headless. 5. Wiki page and log.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verified on an isolated server (port 4599, scratch db) in Chrome on macOS, shell task with mouse reporting on (CSI ?1000h ?1006h): a plain drag made no selection and sent mouse reports; an Option-drag (dispatched as DOM events with altKey, since the drag tool drops modifiers) drew a selection and a real Cmd-C copied 'SELECTME-marker-line'. An OSC 52 write from printf reached navigator.clipboard.writeText as 'hello-osc52' and resolved; an OSC 52 read left nothing typed at the prompt. Unit suite flaked once (3 failures in one of three full runs, 0 in the other two); the change touches only Terminal.tsx and a new util.

Code review (high, --fix) found the always-on Option setting broke Option-click (arrow keys typed into the TUI) and macOS column select, and that hidden terminals could take a copy; fixed by the per-press options and the accepts predicate. Left as documented design: any PTY output can write the clipboard (as in most terminals), browsers on two machines both take a copy, and a copy held in the router queue before mount can be written on mount. Re-verified after the fixes on a fresh isolated server: Option-drag with tracking on selects and Cmd-C copies 'SELECTME-marker-line'; an Option-click with tracking on sends no input frames (probe confirmed to catch an arrow key); OSC 52 write reaches writeText. bun run typecheck clean; test:render 643 pass; unit 2326 pass after the review.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Terminal tabs can now be copied from on a Mac while Claude Code holds the mouse, local or remote. Option-drag forces an xterm selection (Cmd-C copies it, plain HTTP included) only while the program tracks the mouse, with Option-click cursor moves off then; otherwise xterm defaults (column select, Option-click cursor) stand. A program's own OSC 52 copy is written to the browser clipboard in a secure context, from a focused window and a visible terminal only; reads are swallowed unanswered, which is why this is a small handler and not @xterm/addon-clipboard. Review: six findings, three fixed, wiki corrected for a fourth, two left as documented design (unprompted OSC 52 writes; a held-queue copy written on mount). Verification: Chrome on an isolated server with mouse tracking on, before and after the review fixes. Follow-up risk: Safari and Firefox may refuse writeText without a user gesture (untested); the unit suite flaked once (3 of 2320) in one of three runs.
<!-- SECTION:FINAL_SUMMARY:END -->
