---
id: TASK-112
title: 'Composer: one draft that survives leaving and coming back'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-26 02:01'
updated_date: '2026-09-26 02:51'
labels:
  - frontend
  - composer
dependencies: []
references:
  - src/frontend/components/Composer.tsx
  - src/frontend/composer-request-store.ts
  - src/frontend/hooks/use-task-nav.ts
  - src/frontend/routes/index.tsx
  - src/frontend/components/Composer.render.tsx
ordinal: 114000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Reproduce: type part of a prompt in the composer at /, click a task in the sidebar to check something, then press the header's New task (+) to come back. The prompt is gone, and so are any attachments and any model/agent/worktree/base-ref overrides. Every field is useState inside Composer (src/frontend/components/Composer.tsx), and Composer unmounts the moment the route leaves /, so there is exactly one copy of what was typed and it dies with the component. Nothing else in the app can bring it back. The fix is a single composer draft: one module store (in the shape of composer-request-store.ts and sidebar-store.ts) holding the prompt, the selected project id, the model/profile/worktree/baseRef overrides plus the seededFor marker that says which project they were seeded from, and the attachments. Composer reads and writes it through useSyncExternalStore instead of local state, so navigating away and back lands on the same draft. The draft is in-memory for this session: File objects and object URLs cannot go to localStorage, and the reported problem is losing the draft within a session, so a reload starting fresh is acceptable (persisting just the prompt text is a possible follow-up, not part of this). The project ask keeps working the way TASK-77/82 settled: a project group's + still moves the draft's project selection (and re-seeds the per-project options, as today) while leaving the prompt and attachments alone; composer-request-store folds into the draft store, since a request is now just a write to the draft's project. The header's + and a plain / arrival do NOT reset the project: they return to the draft as it was. A copied /?project=<id> URL still seeds the project on a fresh draft. A successful submit clears the draft (and releases the attachments' object URLs); a failed submit leaves everything in place, as today. Object URLs are no longer released on unmount, only on remove, discard or submit. Consider (decide during implementation, not required): a small indicator on the New task button or in the composer that an unsent draft exists, and a way to discard it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Typing a prompt, adding an attachment and changing a chip, then opening a task and returning to / via the header's +, shows the same prompt, attachment and chips
- [x] #2 A project group's + moves the draft's project (re-seeding model/agent/worktree/base ref from that project) and leaves the prompt and attachments untouched, including when the composer is not currently mounted
- [x] #3 The header's + and a plain arrival at / keep the draft's current project rather than resetting to the first project or to ?project=
- [x] #4 A fresh draft still honours a copied /?project=<id> URL
- [x] #5 A successful submit clears the draft and releases attachment object URLs; a failed submit leaves the draft intact
- [x] #6 Rendering tests cover unmount/remount retention, the header + versus project + behaviour, and clearing on submit; the draft store has a bun test
- [x] #7 Doc comments in Composer.tsx and docs/v2-architecture.md §7.5 describe the draft
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. New src/frontend/composer-draft-store.ts: one in-memory ComposerDraft { prompt, projectId, model|null, profile|null, worktree|null, baseRef|null, attachments, urlProject } behind useSyncExternalStore (subscribe/get). Overrides are nullable and DERIVED against the selected project at render (null = project default), so re-seeding on a project change is just clearing them in setComposerDraftProject; no seededFor state. requestComposerProject(id) is the + press (sets project and urlProject); applyComposerUrlProject(param) is called from a useLayoutEffect in Composer and moves the project only when the param differs from urlProject, so a remount at the same address re-applies nothing while Back/Forward and a copied URL still land. add/remove attachment helpers live on the store (remove releases the object URL); clearComposerDraft releases every attachment and resets all but projectId/urlProject; resetComposerDraft for tests. composer-request-store.ts and its test are deleted. 2. Move Attachment/toAttachment/releaseAttachment from AttachmentStrip.tsx into lib/attachments.ts so the store (a .ts file, bun test) imports no component. 3. Composer.tsx reads the draft via useSyncExternalStore, writes through the store, drops the unmount URL-release effect and the seededFor block; error/submitting/dragDepth stay local; submit success calls clearComposerDraft before openTask. 4. useOpenComposer calls requestComposerProject as before. 5. Tests: composer-draft-store.test.ts (bun); Composer.render.tsx gains unmount/remount retention, project + while unmounted, header + keeps the project, clear on submit; use-task-nav.render.tsx asserts the draft instead of seq. 6. Doc comments in Composer.tsx and routes/index.tsx; docs/v2-architecture.md §7.5 gets a draft paragraph.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented as planned. The draft store (composer-draft-store.ts) holds prompt, projectId, four nullable chip overrides, attachments and urlProject; the composer derives each chip as override ?? project column, so a project change re-seeds by clearing the overrides and there is no seededFor state. The URL param goes through applyComposerUrlProject from a useLayoutEffect and is applied only when it differs from the last one applied, so a remount at the same address (Back to /?project=web after a task detour) leaves a hand-moved chip alone while Back/Forward across different params and a copied link still land. requestComposerProject writes the draft directly and records the address it navigates to. composer-request-store.ts and its test are deleted; Attachment/toAttachment/releaseAttachment moved from AttachmentStrip.tsx to lib/attachments.ts so the .ts store imports no component. Object URLs are released on remove, clear and test reset, never on unmount. Decision not in the AC: a successful submit clears everything but keeps the project (and urlProject), since the next task is usually in the same project. A project deleted elsewhere while the draft names it falls through to the first project with the overrides still in place; the previous code re-seeded there and this one does not, judged too rare to carry a seededFor record for. Not done, as the description allowed: the unsent-draft indicator and a discard control. Validation: bun run test:unit 1677 pass (10 new store tests, 5 removed with the request store); bun run test:render 383 pass (6 new in Composer.render.tsx, 1 rewritten in use-task-nav.render.tsx); bunx tsc --noEmit clean. Browser check on an isolated server (port 4599, scratch db): typed a prompt and chose Opus, opened a task, pressed the header + and both were back; pressed web's + and the chip moved to web with the model re-seeded to web's Sonnet default and the prompt intact; opened the task and pressed Back to /?project=web and the draft was still there.

Code review (/code-review high) after the first commit found five defects, all fixed in a second commit: (1) the in-flight submit flag was component state while the draft was global, so a remount mid-upload could send the same draft twice and a stale continuation could clear a newly typed one; submitting now lives in the draft, the store refuses files while it is set, and a remount finds the button disabled. (2) selecting the project already selected cleared the chip overrides (Back to /?project=web after a plain / detour dropped a chosen model); a move is now only a change of project, and the same id is a no-op with no write. (3) a deleted project's overrides were carried to the fallback project; a second layout effect settles the draft's projectId to the resolved project, read from the live store, which clears them. (4) the + press recorded urlProject before its navigation landed; it is now recorded only where the address is applied, and the press just moves the project. (5) applying an address was two writes; it is one. Tests: 5 store tests and 3 rendering tests added, one nav test corrected; unit 1682 pass, render 386 pass, tsc clean; browser re-check of scenario (2) on the isolated server passes.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The composer holds one in-memory draft in composer-draft-store that outlives the pane: leaving / to look at a task and coming back through the header + (or Back) lands on the same prompt, attachments and chip overrides. A project group's + still moves the draft's project and re-seeds its chips without touching the prompt; a copied /?project= link still seeds a fresh draft; a successful submit clears the draft but keeps the project. composer-request-store is folded into it. Verified by both test runners, tsc and a browser walk-through on an isolated server.
<!-- SECTION:FINAL_SUMMARY:END -->
