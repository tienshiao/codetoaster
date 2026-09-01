---
id: TASK-70
title: The suspended pill is the only rounded-full chrome in the app
status: Done
assignee:
  - '@claude'
created_date: '2026-09-01 00:06'
updated_date: '2026-09-01 00:55'
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
- [x] #1 The overlay uses the design system radius, surface and shadow tokens; no rounded-full and no literal shadow
- [x] #2 The button is a v2 Button at one of its own sizes, not a hand-set height
- [x] #3 Whether this becomes a Notice or stays bespoke is a decision the code states, with the reason
- [x] #4 All three states still render: restoring with its two labels, failed with the truncated cause, and suspended
- [x] #5 Clicks outside the button still reach the terminal underneath
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Stays a floating card; adopts the tokens. `rounded-full` → `rounded-md`, `bg-pane/95` → `bg-pane`, `shadow-lg` → `shadow-overlay`, the hand-set `h-7` → `Button size=\"sm\"`, and the hand-rolled `size-2 animate-pulse rounded-full bg-state-busy` → `StatusDot state=\"busy\"`, which is the same thing the design system already owns (and animates with `animate-busy-pulse` rather than Tailwind's default `animate-pulse`).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Not a Notice, and the reason is the snapshot

`Notice`'s own comment draws the line at transient-versus-state and puts this on the transient side. That is only half right — `Suspended` waits for an answer and is exactly the state a Notice describes — but it lands in the right place for a better reason.

A Notice sits *in the flow*. In this pane that means giving the terminal a different height, which renegotiates the grid and reflows the restored scrollback — rewrapping the screen the user came back to read, at the moment they came back to read it. That is the same reason the overlay is not a line written into the grid, and it is now written down where the next person will look.

What it was not allowed to be is off the system, which it was: the only `rounded-full` chrome in the app, over `bg-pane/95` and a raw `shadow-lg`, with a hand-set button height and a hand-rolled status dot. Every other `rounded-full` left in the tree is a dot or a bar, which is a shape those genuinely are.

## Validation

`tsc --noEmit` clean; `bun run test`: 928 unit + 125 render, 0 fail.

In Chrome at :4599, over a real suspended task: the plain `Suspended / Reopen` card sitting over the retained snapshot with the terminal readable underneath, and the `Could not resume this task / Try again` state. The restoring state lasts a few hundred milliseconds and is not something a screenshot catches reliably, so it is pinned by a test instead — a `resumeTask` that never resolves — along with the resting state, neither of which the file covered before. That second test also documents something worth knowing: a task suspended *after* the pane mounted does not auto-reopen, which is what the `resting` prop's comment says and nothing asserted.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The suspended overlay stops being the only rounded-full chrome in the app: rounded-md, an opaque bg-pane, shadow-overlay, a Button at its own size instead of a hand-set h-7, and StatusDot instead of a hand-rolled pulsing dot. It stays a floating card rather than becoming a Notice, and the code now says why — a Notice sits in the flow, which would resize the terminal and reflow the restored scrollback the user came back to read. All three states verified: two in the browser, and the restoring one pinned by a test since it is too brief to screenshot. 928 unit + 125 render tests pass.
<!-- SECTION:FINAL_SUMMARY:END -->
