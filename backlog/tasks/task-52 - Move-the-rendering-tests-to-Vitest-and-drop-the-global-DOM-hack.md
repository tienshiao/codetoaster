---
id: TASK-52
title: 'Move the rendering tests to Vitest, and drop the global-DOM hack'
status: Done
assignee:
  - '@claude'
created_date: '2026-08-30 04:45'
updated_date: '2026-08-30 04:59'
labels:
  - frontend
  - test
dependencies: []
ordinal: 52000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-51 put Happy DOM behind Bun's preload, which is global: the server tests get a DOM they do not want, and setup-dom.ts has to capture and restore Bun's fetch/Request/Response/streams so their identity checks keep passing. That works, but the NATIVE list is standing debt - if Happy DOM starts overwriting something else, or a server test reaches for a global that is not on the list, the failure lands far from its cause. Bun has no per-file test environment, so there is no way to scope the DOM from inside bun test.

The split line is not frontend vs backend, it is renders vs does not - and it is already the file extension. Thirteen of the fifteen frontend test files are pure logic (parseDiff, commitGraph, layout-store, drag, view-state-store) and must stay on bun test: they need no DOM, and moving them would only make them resolve modules through a second bundler for no benefit.

So: *.test.tsx runs under Vitest with environment: happy-dom, everything else stays exactly as it is under bun test, and one script runs both.

Worth doing now rather than later because every remaining Phase 4 task - composer, task list, Explorer, extra shell tabs, mobile, shortcuts, command palette - is component work. Two files is a trivial migration; fifteen is one nobody gets round to.

Known cost, accepted: vite.config's @/* alias has to mirror tsconfig's, and can drift, so tests could resolve a module differently from the app that ships. That risk is real and does not go away; it is the price of the isolation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 bun test runs every non-rendering test with no DOM present and no preload, and setup-dom.ts is deleted
- [x] #2 Vitest runs the *.test.tsx files under happy-dom, resolving @/* the way the app does
- [x] #3 One command runs both suites, and CLAUDE.md states the boundary rule and why the exception exists
- [x] #4 The regression tests still fail against their reverted fixes after the move
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done, with one design change forced by a Bun quirk.

The intended split was *.test.tsx excluded from bun test via --path-ignore-patterns (or bunfig's pathIgnorePatterns). Both work when bun test is typed at a shell, and BOTH are silently ignored when the same command runs under 'bun run' - verified repeatedly: bare 'bun test' ran 41 files, 'bun run test:unit' with the identical string ran 43. Tried the space form, the = form, quoted and unquoted, and via bash rather than Bun's shell; under bun run the flag's value is either dropped or taken as a positional filter. An exclusion that holds when you test it by hand and fails in CI is worse than none, so it is not used.

Instead the boundary is a filename Bun cannot discover: Bun requires .test/.spec in the name, so rendering tests are *.render.tsx and are invisible to bun test with nothing configured. Vitest includes src/**/*.render.tsx. Nothing has to be kept in sync for the two suites to stay disjoint, which was the whole point.

Layout:
- bun test -> 41 files, 639 tests, no DOM, no preload. bunfig's [test] section is gone.
- vitest run -> 2 files, 12 tests, environment happy-dom, setupFiles test/setup-rendering.ts.
- bun run test runs both; test:unit and test:render run one each.
- test/setup-dom.ts and its NATIVE restore list are deleted, which was the point of the exercise. test/matchers.d.ts went too - Vitest's expect already carries the jest-dom types.
- vitest.config.ts mirrors tsconfig's @/* alias. That mirroring is the standing cost and is called out in CLAUDE.md.

CLAUDE.md's Testing section now states the rule as a table, says why *.render.tsx must not be renamed to *.test.tsx, and notes that Happy DOM has no layout engine so geometry-dependent behaviour is better checked in a browser via the verify skill.

Discrimination re-checked after the move: reverting both fixes fails exactly the same 4 of 12 (three useViewState, one TabArea) as it did under bun test. The move changed no test's meaning.

bunx tsc --noEmit exits 0. bun run test: 639 pass / 0 fail and 12 pass / 0 fail.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Rendering tests moved to Vitest under happy-dom; everything else stays on bun test with no DOM and no preload, so test/setup-dom.ts and its restore-Bun's-globals hack are deleted. The split is enforced by filename (*.render.tsx, which Bun does not discover) rather than by an ignore flag, because both --path-ignore-patterns and bunfig's pathIgnorePatterns are silently ignored under 'bun run' and would have failed only in CI.
<!-- SECTION:FINAL_SUMMARY:END -->
