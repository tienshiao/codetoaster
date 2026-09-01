---
id: TASK-70
title: The suspended pill is the only rounded-full chrome in the app
status: To Do
assignee: []
created_date: '2026-09-01 00:06'
labels:
  - frontend
  - ui
  - polish
milestone: m-5
dependencies: []
ordinal: 70000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Suspended / Reopen overlay in `AgentPane` is drawn as a pill: `rounded-full` on the container and `rounded-full h-7` on the button inside it. Nothing else in the v2 surface is round. Rows, dialogs, inputs, badges, buttons and the hover clusters are all `rounded-md`, and the shell reads as one thing because of it — this floats over a terminal looking like it came from somewhere else.

It is off the system in smaller ways too. The container uses `bg-pane/95` and `shadow-lg` where the v2 tokens are an opaque `bg-pane` and `shadow-overlay`, and the height of the button is a literal `h-7` rather than a size the Button component already has.

Worth deciding rather than just re-radiusing: this is a notice with an action in it, and `Notice` in `components/v2/` already is that. If it fits, the overlay should be a `Notice` positioned over the pane rather than a bespoke pill, which is one fewer place for the design to drift. If it does not fit — it is transient and floats, where a Notice sits in the flow — then it stays bespoke and simply adopts the tokens.

The three states have to keep working: `restoring` (the pulsing dot and its two labels), `failed` (the cause, truncated by the container so the sentence in front of it stays readable), and plain `Suspended`. So does the pointer behaviour — the overlay is `pointer-events-none` except for the button, so a click anywhere else lands on the terminal underneath.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The overlay uses the design system radius, surface and shadow tokens; no rounded-full and no literal shadow
- [ ] #2 The button is a v2 Button at one of its own sizes, not a hand-set height
- [ ] #3 Whether this becomes a Notice or stays bespoke is a decision the code states, with the reason
- [ ] #4 All three states still render: restoring with its two labels, failed with the truncated cause, and suspended
- [ ] #5 Clicks outside the button still reach the terminal underneath
<!-- AC:END -->
