---
id: TASK-129
title: Type check with bun check instead of tsc
status: Done
assignee:
  - '@claude'
created_date: '2026-10-10 08:08'
updated_date: '2026-10-10 08:42'
labels: []
dependencies: []
ordinal: 131000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Bun 1.4.3 ships a type checker (bun check) that reports the same errors as TypeScript 7 and uses every core: the tree checks in about a second where tsc 5.9.3 took between 10 and 25. The commit gate and docs should name it instead of bunx tsc. It follows TypeScript 7 rules, so the tsconfig has to drop what 7 removed. Scripts run the bun in node_modules, which was 1.3.9 and has no check command, so that copy has to move to 1.4.3 as well.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 bun run typecheck runs bun check and exits 0 on a clean tree
- [x] #2 bun check reports a deliberate type error, including one that depends on the @ alias and noUncheckedIndexedAccess
- [x] #3 tsconfig.json is valid for both bun check and the installed tsc, and the @ alias still resolves in tests and in the served frontend bundle
- [x] #4 CLAUDE.md and the wiki name the new command wherever they named bunx tsc
- [x] #5 The bun that package scripts resolve is 1.4.3 or newer and is declared, and the unit and render suites pass under it
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decisions. (1) dev keeps tsc watch: bun check has no watch mode (bun with the watch flag in front of check runs once and exits), and the hot plus check combination restarts the server on each change and runs nothing on a type error. (2) typescript stays on 5.9.3: 7.0.2 was installed and its tsc watch worked, but the package ships no tsserver.js and no lib d.ts files, and the tsserver language server then reported Cannot find name Set on every file; reverted. (3) Package scripts resolve bun from node_modules/.bin, which held 1.3.9 as a peer of bun-plugin-tailwind, so bun run typecheck first failed with Script not found check. bun is now a devDependency at ^1.4.3, which also moves dev, test and build scripts from 1.3.9 to 1.4.3. (4) CSS side-effect imports fail TS2882 under 7 rules; declared the css wildcard module in src/globals.d.ts, and named noUncheckedSideEffectImports in tsconfig so tsc 5.x applies the same rule. Not done: types for bun stay at 1.3.6 while the runtime is 1.4.3.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
bun run typecheck runs bun check (439 files, about 1s; tsc 5.9.3 took 10 to 25s) and replaces bunx tsc in the commit gate in CLAUDE.md and the wiki. tsconfig drops baseUrl and names noUncheckedSideEffectImports; src/globals.d.ts declares css modules; bun is a devDependency at ^1.4.3 because scripts resolve it from node_modules, which moves dev, test and build scripts off 1.3.9. New wiki gotcha page bun-check-is-typescript-7. Review: no correctness bugs; fixed the 5.x and 7 disagreement on side-effect imports, the undeclared bun pin and an overstated timing; left the stale bun types (1.3.6) and the css wildcard hiding a typo in a stylesheet path. Verification: bun run typecheck and tsc both clean, and both report the same errors on a probe file using the alias and an unchecked index; bun run test green under 1.4.3 (1983 unit, 510 render); isolated server on port 4599 bundled and served the frontend (200, 14.4MB, no unresolved alias imports) and answered task create, diff and delete.
<!-- SECTION:FINAL_SUMMARY:END -->
