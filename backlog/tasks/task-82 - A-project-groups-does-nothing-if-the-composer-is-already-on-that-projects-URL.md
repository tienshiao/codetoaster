---
id: TASK-82
title: >-
  A project group's + does nothing if the composer is already on that project's
  URL
status: Done
assignee:
  - '@claude'
created_date: '2026-09-01 18:52'
updated_date: '2026-09-04 21:07'
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
- [x] #1 Pressing a project group's + always moves the composer's selection to that project, including when the composer is already showing and its chip was changed by hand
- [x] #2 The prompt in the textarea is still untouched by the press
- [x] #3 Whichever way is chosen, the comment in Composer.tsx describes what actually happens
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Decision: neither a nonce in the URL nor writing the chip back. The request travels out of band: a small module store (frontend/composer-request-store.ts, same shape as the other module stores) holding { projectId, seq }; useOpenComposer bumps it before navigating, and the Composer subscribes with useSyncExternalStore and moves its selection whenever seq changes — so a press is a distinct request even when the URL does not change and nothing is pushed to history per chip change. The ?project= search param stays exactly what §7.5 made it: a preference that seeds the selection on arrival (a copied URL still opens on that project) and is not written back. 1. Add the store: requestComposerProject(id) increments seq; subscribe/get for useSyncExternalStore; a reset for tests. 2. useOpenComposer calls it when options.projectId is given, then navigates as today. 3. Composer: the prop seeds initial state only; the lastRequested guard is re-keyed on the store's seq (moving the selection only, never the prompt); the comment above it rewritten to describe this. 4. Tests: Composer.render.tsx — a request for the project already in the URL, after the chip was changed by hand, moves the chip back and leaves the prompt; use-task-nav.render.tsx — openComposer bumps the request; the existing 'arriving while typing' test becomes a store request.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented as planned: the request travels out of band, the URL keeps its §7.5 meaning.

- New `src/frontend/composer-request-store.ts`: `{ projectId, seq }`, `requestComposerProject` (bumps seq and notifies), `subscribeComposerRequest`/`getComposerRequest` for `useSyncExternalStore` (one snapshot object, replaced only on a request), `resetComposerRequest` for tests. Its header records why neither a URL nonce nor writing the chip back was taken.
- `useOpenComposer` calls `requestComposerProject` before navigating when `options.projectId` is given; the `?project=` navigation and the focus are unchanged, so a reload or a copied link still lands on the project.
- `Composer` subscribes to the store and keys its 'adjust state when a prop changes' guard on `seq` instead of on the prop's id; only the selection moves, never the prompt. The prop now seeds the initial selection only — the prop-change branch was dropped, since every ask goes through the store and no other caller changes `?project=` on a mounted composer. Doc comment and inline comment rewritten to say that (AC #3); `routes/index.tsx`'s search-param comment gained a sentence pointing at the store.

Tests: `composer-request-store.test.ts` (5, bun test) covers counting, snapshot identity, notify/unsubscribe and reset. `Composer.render.tsx` — the 'arriving while typing' test now makes a store request, and a new test opens at `/?project=web`, moves the chip to general by hand, types, then requests web and asserts the chip returns while the prompt survives (AC #1, #2). `use-task-nav.render.tsx` — a new test asserts two presses of the same project are seq 1 then 2, and that the header's `+` asks for nothing; the store is reset in both files' `beforeEach`.

Verification: `bun run test:render` 174 passed (20 files); `bun test src/frontend/composer-request-store.test.ts` 5 passed; `bunx tsc --noEmit` clean for every file this task touched (the only errors reported are in `src/lib/worktree/wip.test.ts`, another agent's in-flight work in the same tree).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A project group's + now asks through a small module store (`composer-request-store`) rather than only through `?project=`, so a press moves the composer's selection even when it is already at that project's URL and the chip was changed by hand — and the prompt is untouched. The search param stays the §7.5 preference: it seeds the selection on arrival and is never written back, so nothing meaningless enters the address and no history is pushed per chip change.
<!-- SECTION:FINAL_SUMMARY:END -->
