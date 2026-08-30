---
id: TASK-51
title: 'React test harness, and tests for the two bugs that had none'
status: Done
assignee:
  - '@claude'
created_date: '2026-08-30 04:15'
updated_date: '2026-08-30 04:27'
labels:
  - frontend
  - test
dependencies: []
ordinal: 51000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-23 and TASK-50 each fixed a bug that no automated test could reach, because the repo has no way to render a component: the frontend suite covers pure functions only (parseDiff, commitGraph, drag, layout-store, view-state-store). Both bugs lived in hook and gesture *lifecycle* - when a subscription is bound, when a ref is written - which is exactly what a pure-function test cannot see, and both were caught by a human-driven browser pass that will not run on every change.

Add the harness Bun documents for this (@happy-dom/global-registrator plus @testing-library/react, wired through bunfig.toml preload), then cover the two regressions:

- useViewState with two hooks live on one slot. A split can put the all-files diff and a per-file diff on the task-wide 'review' slot at once; before TASK-23's fix each resolved its updater against a copy taken before the other's write, silently destroying a comment.
- TabArea's gesture refs. A second pointer landing before the first lifts used to kill the drag it was starting (TASK-50).

The harness matters more than either test: every later Phase 4 task (the composer, the task list, the Explorer, keyboard shortcuts) is component work, and none of it currently has a way to be tested below the browser.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 bun test runs React component and hook tests, and the existing suite still passes unchanged
- [x] #2 A test covers two useViewState instances on one slot: a write through one reaches the other, and an updater resolves against the store rather than a stale copy
- [x] #3 A test covers TabArea starting a gesture while another is still installed
- [x] #4 Each new regression test is confirmed to fail against the pre-fix code
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Harness: @happy-dom/global-registrator + @testing-library/react/dom/jest-dom, preloaded from test/setup-dom.ts and test/setup-testing-library.ts via bunfig.toml.

The one non-obvious part is that Bun's preload is global, so the server tests get a DOM too - and a plain GlobalRegistrator.register() broke 33 of them. Happy DOM replaces the fetch-family globals with its own, and the API tests hand real Requests to Bun.serve handlers and assert on real Responses; those checks are identity-based, so a Happy DOM Response fails one that looks identical. setup-dom.ts captures Bun's fetch/Request/Response/Headers/streams/crypto/etc before registering and restores them after: the frontend gets a document, the server keeps its runtime, and 'bun test' stays the single command. Splitting into two commands was the alternative and was rejected - CLAUDE.md documents 'bun test', and a suite you have to know a second incantation for is one that stops being run.

Tests added:

src/frontend/hooks/use-view-state.test.tsx (8) - two instances on one slot see each other's writes; an updater resolves against the store (the comment-loss bug, written as the review flow that lost one); an external setViewField reaches a mounted instance; a write to one field does NOT re-render an instance on another (guards the per-field keying, so a scroll cannot re-render every pane on the slot); two view keys do not wake each other; an unmounted instance stops being notified; mount hydrates from the slot; a write lands on the ref's slot.

src/frontend/components/tabs/TabArea.test.tsx (4) - a drag reorders the strip; a gesture started while another is still installed can still be dragged (TASK-50); a press under the 4px threshold stays a click; pointercancel abandons the move. Happy DOM has no layout engine, so the test stubs the only two things the drag asks the DOM - getBoundingClientRect on the tabs and elementFromPoint - and lays the strip out as equal-width tabs. Assertions read the strip's own order rather than a callback argument.

Discrimination, checked by reverting each fix against a scratchpad copy: 3 of the 8 hook tests fail pre-fix (the two-instance ones), and exactly 1 of the 4 TabArea tests (the double-pointer one). The rest pass either way by design - they guard properties that must keep holding, not the fixes.

bunx tsc --noEmit exits 0; bun test is 651 pass / 0 fail across 43 files, stable over three consecutive runs (was 639/41 before).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the React test harness the repo lacked (Happy DOM + Testing Library, preloaded through bunfig.toml, with Bun's fetch-family globals restored so the server tests are untouched), then covered the two lifecycle bugs that no pure-function test could reach: two useViewState instances on one slot losing each other's writes, and TabArea's gesture ref being nulled by the release of the gesture before it. Each regression test was confirmed to fail against the reverted fix and only against it.
<!-- SECTION:FINAL_SUMMARY:END -->
