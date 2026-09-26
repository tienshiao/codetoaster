---
id: TASK-112
title: 'Composer: one draft that survives leaving and coming back'
status: To Do
assignee: []
created_date: '2026-09-26 02:01'
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
- [ ] #1 Typing a prompt, adding an attachment and changing a chip, then opening a task and returning to / via the header's +, shows the same prompt, attachment and chips
- [ ] #2 A project group's + moves the draft's project (re-seeding model/agent/worktree/base ref from that project) and leaves the prompt and attachments untouched, including when the composer is not currently mounted
- [ ] #3 The header's + and a plain arrival at / keep the draft's current project rather than resetting to the first project or to ?project=
- [ ] #4 A fresh draft still honours a copied /?project=<id> URL
- [ ] #5 A successful submit clears the draft and releases attachment object URLs; a failed submit leaves the draft intact
- [ ] #6 Rendering tests cover unmount/remount retention, the header + versus project + behaviour, and clearing on submit; the draft store has a bun test
- [ ] #7 Doc comments in Composer.tsx and docs/v2-architecture.md §7.5 describe the draft
<!-- AC:END -->
