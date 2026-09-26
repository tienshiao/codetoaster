---
id: TASK-115
title: >-
  Hover cards paint above the archive dialog's scrim, and a dialog with a
  disabled confirm leaves focus behind it
status: Done
assignee:
  - '@claude'
created_date: '2026-09-26 04:35'
updated_date: '2026-09-26 05:14'
labels:
  - frontend
  - ui
  - v2
dependencies: []
references:
  - src/frontend/components/v2/Dialog.tsx
  - src/frontend/components/v2/HoverCardParts.tsx
  - src/frontend/components/TaskSidebar.tsx
ordinal: 117000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Opening a task row's archive confirmation while the pointer is on the row can leave the row's hover card drawn over the dialog's shade. Two things combine. The scrim in components/v2/Dialog.tsx and the hover card panel in components/v2/HoverCardParts.tsx are both z-50, so whichever portal mounts later paints on top. And the dialog's focus call (input, textarea, button[data-confirm]) is a no-op while ArchiveTaskDialog's confirm is disabled during the cost preview, so focus stays on the archive icon inside the hover card's Radix trigger: no blur reaches the trigger, the card's 400ms open timer fires after the scrim has mounted, and the card lands above it. Reproduced on 2026-09-26 against the live app: with the dialog open, document.body held the dialog portal then the hover card portal, both z-50, and the active element was the row's archive button. Fix both halves. A hover card is display-only and must sit under every other floating surface, so the shared card class drops to z-40 while menus, selects, the palette and dialogs stay at 50; mount order then cannot put a card over a scrim. And the dialog always takes focus on open: the first input or textarea, else the confirm button when enabled, else the Cancel button, else the form itself (tabIndex -1), so the opener's blur closes an open card and cancels a pending one, and Escape and Tab act on the dialog rather than the row behind the shade.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The shared hover card panel class is z-40 and no other floating v2 surface drops below it; a comment beside the value states the layer rule (a hover card sits under every other floating surface)
- [x] #2 Dialog moves focus into itself on open even when its confirm button is disabled: first field, else enabled confirm, else Cancel, else the form; the fallback order is stated in a comment
- [x] #3 Rendering tests: a Dialog opened with confirmDisabled from a focused opener button ends with focus inside the dialog; a Dialog with a field focuses the field; the hover card panel carries z-40
- [x] #4 Both runners and tsc are green, and the archive flow verified in a browser shows the shade over the row with no card above it
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
HoverCardParts: card class z-50 -> z-40 with the layer rule stated beside it. Dialog: firstFocusTarget(form) picks first input/textarea, else enabled confirm, else first enabled button, else the form (tabIndex -1, outline-none). New Dialog.render.tsx (disabled confirm from a focused opener lands on Cancel; dismiss-only disabled lands on the form; field; enabled confirm; closed renders nothing) and a z-40 test in TaskHoverCard.render.tsx. test:render 401 pass, tsc clean, test:unit 1713 pass on rerun (first run, in parallel with the other suites, had 6 fails + 5 errors that did not reproduce).

Browser (isolated server :4599, scratch db): hovered a shell task row and clicked its Archive icon in the same hover. Dialog opened with activeElement = Cancel inside role=dialog; the hover card still mounted after the scrim (portal order: scrim z-50, then card z-40) but is drawn under the shade, dimmed. Escape closed the dialog; task not archived.

Review pass (code-review high) fixed five findings: the field selector skips disabled and hidden inputs; the dialog records document.activeElement on open and focuses it again on close when still connected, so Tab resumes from the opener instead of the top of the document; the last-resort focus target is the form, not Cancel, and a second effect hands focus to the confirm when it enables while the panel still has it, so Enter in the archive confirmation no longer depends on how fast the cost preview lands; DiffLayout's sticky prev/next pill drops to z-30 so it no longer paints over a hover card; the comment no longer claims Escape depended on focus (its listener is on document). Also fixed a fused class the first pass left (outline-noneborder) that dropped the panel border. Tests: Dialog.render.tsx covers the panel fallback, the confirm taking focus on enable, not stealing it from Cancel, a disabled first field skipped, focus returned to the opener, and an unmounted opener left alone. After the fixes: test:render 405 pass, test:unit 1713 pass, tsc clean.

Follow-up from the user's code-review --fix run: HoverCardShell's trigger no longer opens on focus (onFocus preventDefault, which Radix checks before its own handler), since the dialog's focus return landed on the archive icon inside the trigger and reopened the card with the pointer elsewhere; TaskHoverCard.render.tsx drives the delay with fake timers to show the pointer still opens it and focus does not. read.ts's fence detector now tracks the opening fence's character and length per CommonMark, with a test for a four-backtick block quoting three-backtick fences and a tilde block holding a backtick line. Verified with the verify skill on an isolated server: hover, Archive, Cancel by mouse, and hover, Archive, Escape; in both, no card portal exists after the dialog closes, focus is back on the archive icon, and the row is still listed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Hover cards sit one layer under every other floating surface (z-40; the diff view's in-pane pill drops to z-30), so mount order can no longer put one over a dialog's scrim. The v2 Dialog always takes focus on open (field, else enabled confirm, else the panel), hands it to the confirm when that enables, and returns it to the opener on close. Cause reproduced in the live app on 2026-09-26; fix verified in Chrome from an isolated server, with rendering tests for the layer and every focus rule, and a code review whose findings were fixed.
<!-- SECTION:FINAL_SUMMARY:END -->
