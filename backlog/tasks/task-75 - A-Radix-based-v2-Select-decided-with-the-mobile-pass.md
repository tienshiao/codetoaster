---
id: TASK-75
title: A Radix-based v2 Select
status: To Do
assignee: []
created_date: '2026-09-01 08:44'
updated_date: '2026-09-01 18:03'
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
- [ ] #1 The v2 Select is a Radix Select styled from the semantic tokens, living in components/v2/ with no new dependency
- [ ] #2 Typeahead, arrow keys and the accessibility tree are no worse than the native element's, verified not assumed
- [ ] #3 The Terminal Theme list is filterable and previews each theme's palette beside its name
- [ ] #4 Escape over an open popup inside a Dialog closes the popup only, covered by a rendering test
- [ ] #5 Every existing consumer — composer chips, ProjectSettingsDialog, SettingsDialog's five — is on the new control
<!-- AC:END -->
