---
id: TASK-59
title: Settings is v1 shadcn inside the v2 shell
status: Done
assignee:
  - '@claude'
created_date: '2026-08-30 23:10'
updated_date: '2026-09-01 08:02'
labels:
  - frontend
milestone: m-5
dependencies: []
ordinal: 59000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`components/SettingsDialog.tsx` was orphaned when the v1 routes went and TASK-28 reconnected it to `AppShell`'s Settings button, which until then did nothing. Reconnecting it was the right call — it is where the notification sound, the bell, the theme and the terminal font live, and with it unreachable the sound TASK-28 moved into `TaskContext` could never be switched on — but it is still drawn from `components/ui/` (v1 shadcn) and reads as a different application from the shell around it.

Port it to `components/v2/`: `Dialog`, `Select` and `Button` all exist there. Per CLAUDE.md the v2 design system is the UI this branch is being rebuilt into, and `components/ui/` is not to grow — this is one of the last places still leaning on it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The settings dialog is composed from components/v2 and uses the semantic tokens, no colour literals
- [x] #2 Every setting it carries today still works: theme, terminal theme, font, size, notification sound, bell sound
- [x] #3 components/ui/ is no larger than before, and smaller if the port frees a primitive
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. **Extend v2 `Dialog` first — the shapes do not match.** The v2 `Dialog` is a *form*: `onConfirm` is required and the footer is always Cancel + Save. Settings is not that. Every control here writes to `localStorage` the moment it changes, so a Cancel that reverts nothing is a lie and a Save that saves nothing is noise. Make `onConfirm` optional; without it the dialog is dismiss-only and draws a single `Done`, and submit just closes.

Extending the primitive rather than hand-rolling a second panel is the point of AC #1: the scrim, the portal, Escape and the focus call are exactly what must not be duplicated. `max-w-sm` is already overridable through the existing `className` passthrough, so `sm:max-w-xl` needs nothing new.

Leave the focus selector alone deliberately — it is `input, textarea, button[data-confirm]`, and `querySelector` returns the first match in *document order*, so adding `select` would focus the Theme dropdown instead of `Done`. Settings has no input or textarea, so `Done` is what gets focus, and Escape and Enter then agree.

2. **Rewrite `SettingsDialog` against `components/v2`.** `Dialog` (dismiss-only), `Select` (native `<select>` taking an `options` array, not shadcn's compound `SelectTrigger`/`SelectItem`), `Button` for the three theme buttons. All six settings keep working: theme, terminal theme, font, size, notification sound, bell sound — including the two that preview their sound on change.

`terminalThemeNames` is `string[]` and needs mapping to `{value,label}`; `SOUND_OPTIONS` is `as const` so its readonly tuple type will not sit in `SelectOption[]` without a spread.

3. **Colour literals go.** The terminal-theme swatch row is `border-zinc-700`, which AC #1 forbids — `border-border`. The swatch *fills* stay as inline `backgroundColor`: those are the terminal palette being previewed, i.e. data, not app chrome.

4. **Delete `ui/dialog.tsx` and `ui/select.tsx`.** Verified: `SettingsDialog` is the only consumer of either. `ui/button.tsx` stays — `DiffView`, `DiffLayout`, `CommitDetail`, `CommentInput` and `CommentDisplay` are all still on it. That is AC #3's 'smaller if the port frees a primitive', twice over.

5. Verify in a browser: open Settings from the sidebar footer and exercise all six controls, since none of this is unit-testable and the whole point is that it stops reading as a different application.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implemented

**The v2 `Dialog` had to grow a mode first, and that was the only real decision here.** It is a *form*: `onConfirm` required, footer always Cancel + Save. Settings is not that shape — every control writes to `localStorage` the moment it is touched, so Save has nothing to do and Cancel has nothing to undo, and offering either says the opposite: that the changes are pending and that leaving by the other button would put them back. `onConfirm` is now optional; without it the dialog is dismiss-only, draws a single `Done`, and submit just closes.

Extending the primitive rather than hand-rolling a second panel is what AC #1 is for — the scrim, the portal, Escape and the focus call are precisely what must not be duplicated. `max-w-sm` was already overridable through the existing `className` passthrough.

The focus selector was left alone on purpose: it is `input, textarea, button[data-confirm]`, and `querySelector` returns the first match in *document order*, so adding `select` would focus the Theme dropdown instead of `Done`. Settings has no input or textarea, so `Done` takes focus and Escape and Enter agree.

**Colour literals.** `border-zinc-700` on the swatch row became `border-border`; the active theme button's `border-primary bg-accent` became `border-selected-border bg-selected text-selected-foreground`, the same vocabulary `TaskRow`, `FileRow` and `ExplorerRail` use for a selected row. Verified all three are real tokens mapped through `@theme inline` with light and dark definitions. The swatch *fills* stay inline: that is the terminal palette being previewed, i.e. data.

**AC #3 pays out twice.** `ui/dialog.tsx` and `ui/select.tsx` are deleted — `SettingsDialog` was the only consumer of either. `components/ui/` is 9 files down to 7. `ui/button.tsx` stays; `DiffView`, `DiffLayout`, `CommitDetail`, `CommentInput` and `CommentDisplay` are all still on it.

Two things the port turned up that the plan had not:

- The v2 `Dialog` panel is `flex flex-col` with no height bound inside a `grid place-items-center` scrim, so it sizes to its content and the body's `overflow-y-auto min-h-0` never engages — six rows would push the footer off-screen rather than scroll. `max-h-[calc(100dvh-2rem)]` restores what shadcn's `DialogContent` gave for free.
- v2 `Select` is an `inline-flex` chip whose inner `<select>` does not grow, so `w-full` alone bunches the value and chevron at the left of an empty control. `justify-between` pins the chevron to the trailing edge as the v1 trigger drew it.

Also: each `Select` now carries an `aria-label`. The `<label>` elements in the left column have no `htmlFor` and never did, so without one the native selects had no accessible name.

## Validation

`tsc` clean; `bun run test` 977 unit + 148 render, 0 fail. Re-grepped `src/` for `ui/dialog`/`ui/select` — only the prose mention in `v2/Dialog.tsx`'s own doc comment, updated to past tense.

Driven in a browser, since 'stops reading as a different application' is not unit-testable:
- All five selects wrote through to `localStorage` (`terminal-theme=AdventureTime`, `terminal-font=JetBrainsMono`, `terminal-font-size=20`, `notification-sound=chime`, `bell-sound=ping`), and the swatch row appeared with ten real palette colours.
- The theme buttons work and — the thing worth checking, since the dialog is now a `<form>` — do **not** submit it: `Button` hardcodes `type="button"` before `{...rest}`, so the panel stays open while the app repaints light. `Dialog`'s own confirm still gets `type="submit"` through rest.
- One `Done`, no `Cancel`; both Escape and `Done` dismiss. No console errors.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
SettingsDialog is composed from components/v2 and components/ui/ is two files smaller.

The port needed the v2 Dialog to grow a dismiss-only mode first: it was a Cancel/Save form, and settings applies every change on touch, so Save had nothing to do and Cancel nothing to undo. `onConfirm` is now optional and its absence means one `Done` button. Extending the primitive is what kept the scrim, portal, Escape and focus handling from being duplicated.

`ui/dialog.tsx` and `ui/select.tsx` deleted — SettingsDialog was the only consumer of either. Colour literals replaced with the selected-row tokens the rest of v2 uses; swatch fills stay inline because they are the terminal palette being previewed, not chrome.

Verified in a browser: all six settings still write through to localStorage, the swatch row renders, the theme buttons do not submit the enclosing form, and Escape and Done both dismiss. 977 unit + 148 render, 0 fail.
<!-- SECTION:FINAL_SUMMARY:END -->
