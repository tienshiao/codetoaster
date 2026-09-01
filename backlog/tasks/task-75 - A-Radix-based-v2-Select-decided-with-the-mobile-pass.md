---
id: TASK-75
title: A Radix-based v2 Select
status: Done
assignee: []
created_date: '2026-09-01 08:44'
updated_date: '2026-09-01 18:31'
labels:
  - frontend
  - ui
  - design-system
milestone: m-5
dependencies:
  - TASK-33
ordinal: 75000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The v2 `Select` is a native `<select>` wearing the design system's paint. **Decided 2026-09-01: it goes.** The user's verdict on the current control — "I'm not a huge fan of the button that triggers a native select list in Settings, and I like them even less on the Compose screen" — settles what TASK-33 was going to be asked to settle. The OS menu is not the design system, and on the composer's chips it is conspicuous.

Build a Radix-based `Select` in `components/v2/`. `radix-ui` ^1.4.3 is already a dependency, so this costs nothing new and does not regrow `components/ui/`. Radix keeps typeahead, arrow keys and the ARIA tree — it is not a naive reimplementation. What is given up is the platform picker on touch, an iOS wheel instead of a scrolling popup; TASK-33 revisits that against a real device if it turns out to matter.

Two things the native element could not do, and that the styled popup is partly for:

- **Terminal Theme is 157 options.** It needs a filter, and it should draw each theme's palette beside its name — today the swatch row only shows a theme *after* it is applied, so choosing one means picking blind off an alphabetical list.
- **The composer's chips** get a popup that belongs to the app.

**One trap.** `Dialog` binds Escape to `document` and does not know about nested layers, so Escape over an open popup inside a settings dialog would dismiss both. Radix's `DismissableLayer` listens in the capture phase, which gives `onEscapeKeyDown` somewhere to stop the event before `Dialog` sees it — verify that rather than assume it, and cover it with a rendering test.

Consumers: the composer's project and model chips, `ProjectSettingsDialog`'s default model, and `SettingsDialog`'s five.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The v2 Select is a Radix Select styled from the semantic tokens, living in components/v2/ with no new dependency
- [x] #2 Typeahead, arrow keys and the accessibility tree are no worse than the native element's, verified not assumed
- [x] #3 The Terminal Theme list is filterable and previews each theme's palette beside its name
- [x] #4 Escape over an open popup inside a Dialog closes the popup only, covered by a rendering test
- [x] #5 Every existing consumer — composer chips, ProjectSettingsDialog, SettingsDialog's five — is on the new control
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Radix Select in `components/v2/Select.tsx`, no new dependency. API changed from `onChange(event)` to `onValueChange(value)`; all eight call sites moved.

Three things the swap forced, each commented at the site:

1. **The empty string.** Radix throws on an item valued `""` and reads a root value of `""` as 'show the placeholder'. `""` is this system's 'someone below me decides', so it is swapped for a sentinel at the boundary and back on the way out. Callers are unchanged.
2. **The trigger's text** comes from the `options` prop, not from the selected `ItemText` portaling into it (Radix's default). Filtering unmounts rows, and an unmounted selected row would blank the chip. Passing children to `Select.Value` is Radix's own opt-out (`valueNodeHasChildren`).
3. **The filter is not a focusable input.** That was the first design and it cannot work: Radix focuses the selected item as soon as the popper reports itself positioned, so a box taking focus on mount loses it a frame later, and `Select.Content` has no `onOpenAutoFocus` to prevent it. Typing is intercepted on the content instead — `preventDefault` makes Radix skip its own typeahead, since it composes a caller's handler ahead of its own. Focus stays in the list, so arrow keys and Enter are untouched.

Escape: `onEscapeKeyDown` + `stopPropagation`. Radix's DismissableLayer listens in the *capture* phase, which is early enough to take the event out of the path before `Dialog`'s own document listener is reached. Verified both ways in happy-dom and in Chrome — one press closes the popup, the dialog stays, a second press closes the dialog.

Keyboard verified in Chrome, not happy-dom: with `position=\"popper\"` Radix moves focus only once floating-ui reports the content placed, and happy-dom has no layout, so focus never leaves `body` there. ArrowDown/ArrowDown/Enter moved Project default → Opus in the real browser. `test/v2-select.ts` documents this and aims keystrokes at the listbox.

Terminal Theme: `filterPlaceholder` plus a palette strip on every one of the 157 rows, from a new `terminalThemeSwatches` export so the row preview and the strip under the setting are the same ten colours in the same order.

Fixed while in there: the preview strip's ten fixed 28px swatches came to 334px against a 311px column, and an `fr` track takes its minimum from its content — so it was widening the whole second column and leaving that one row's select 23px left of the four below it. All five now sit at 710/311, measured in the browser.

New: `src/frontend/components/v2/Select.render.tsx` (9 tests) and `test/v2-select.ts`. 166 render tests pass, `tsc --noEmit` clean, no console errors in Chrome in either theme.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The v2 Select is Radix: a popup drawn from the design system's own tokens, with a filter and a per-row preview the OS menu could never have. Terminal Theme's 157 entries now show their palettes and filter as you type. Keyboard and the Escape-inside-a-Dialog case verified in Chrome, not just in happy-dom.
<!-- SECTION:FINAL_SUMMARY:END -->
