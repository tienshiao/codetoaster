---
id: TASK-82
title: >-
  A project group's + does nothing if the composer is already on that project's
  URL
status: To Do
assignee: []
created_date: '2026-09-01 18:52'
labels:
  - frontend
  - ui
  - bug
milestone: m-5
dependencies: []
ordinal: 82000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Reproduce: press project "web"'s `+` in the sidebar (the composer opens at `/?project=web`), then change the project chip by hand to "general", then press web's `+` again. Nothing happens — the chip stays on "general".

The composer tracks *what was last asked for* rather than what is selected, so a hand-made selection is not undone on every render:

```ts
const [lastRequested, setLastRequested] = useState(requestedProjectId ?? null);
if ((requestedProjectId ?? null) !== lastRequested) { ... }
```

That is the right instinct and the guard is doing its job. What defeats it is that the request arrives as a *search param*: `useOpenComposer` navigates to `/?project=web`, and when that is already the URL the navigation is a no-op, the prop never changes, and the guard correctly concludes nothing was asked for. The comment above the block says "asking for the same project twice after a detour still lands", which is only true of a detour that changes the search param.

Not urgent — a button that appears inert is the whole of it, nothing is lost or miswritten. Filed rather than fixed inline because both ways out are a design decision, not a patch:

- **A nonce in the search param** (`?project=web&n=2`), which makes every press a distinct navigation but puts a meaningless token in a URL a user might copy.
- **Write the chip back to the search param**, so the URL always names the selection. That makes the param an address rather than the preference §7.5 deliberately made it, and it means every chip change pushes history.

Found by `/code-review` while reviewing TASK-80/75/81; predates them (TASK-77).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Pressing a project group's + always moves the composer's selection to that project, including when the composer is already showing and its chip was changed by hand
- [ ] #2 The prompt in the textarea is still untouched by the press
- [ ] #3 Whichever way is chosen, the comment in Composer.tsx describes what actually happens
<!-- AC:END -->
