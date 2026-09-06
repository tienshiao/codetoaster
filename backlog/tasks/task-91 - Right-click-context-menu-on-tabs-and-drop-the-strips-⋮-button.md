---
id: TASK-91
title: 'Right-click context menu on tabs, and drop the strip''s ⋮ button'
status: To Do
assignee: []
created_date: '2026-09-06 07:55'
labels:
  - frontend
dependencies: []
ordinal: 95000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A right-click on a tab opens a menu of the tab actions VS Code users expect: close variants, split, move to the other group, pin. The strip's trailing ⋮ ("Tab actions") button is removed along with its unwired onTabActions prop chain through TabStrip, TabArea and AppShell: everything it would hold is already on the strip (split, new shell), in the keymap, in the palette, or in this menu.

The v2 design system's DropdownMenu spec (Claude Design project 06f63995-570a-486c-af82-d70b8fa5976b, components/overlays/DropdownMenu.prompt.md) covers context and overflow menus and names the tab strip as a use; no v2 DropdownMenu component exists yet in components/v2/, so this task builds it (over Radix, whose dropdown-menu and context-menu packages are already installed) as the first consumer. Keep to the spec: destructive items last after a separator, under about eight items.

Every action maps onto layout-store.ts, which already owns close (with the agent tab's unclosable rule), splitTab with canSplit, moveTab, pinTab and mergeGroups. Close Others, Close to the Right and Close All are new compositions in the store, unit-tested there, so the menu is a third entrance to one table alongside TASK-34's chords and TASK-35's palette rather than new behaviour. Key hints on items come from chordCaps so the chord spelling stays in one place.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Right-clicking a tab opens a menu anchored at the pointer with: Close, Close Others, Close to the Right, Close All, a separator, Split, Move to Other Group (or Move to New Group when there is one group), and Pin when the tab is a preview
- [ ] #2 The agent tab cannot be closed by any item, and Close Others / Close All leave it in place; Split is disabled on terminal tabs with the existing reason
- [ ] #3 Items that have a leader chord show it via chordCaps, matching the palette's spelling on each platform
- [ ] #4 Close Others, Close to the Right and Close All are layout-store operations with unit tests, including the agent-tab and last-tab-in-group cases
- [ ] #5 A v2 DropdownMenu component exists in components/v2/, follows the design spec, and is the only menu primitive the strip uses
- [ ] #6 The ⋮ button and the onTabActions prop are gone from TabStrip, TabArea and AppShell
- [ ] #7 Verified in Chrome: the menu opens on right-click over a tab in either group, actions take effect, and Escape or a click outside dismisses it
<!-- AC:END -->
