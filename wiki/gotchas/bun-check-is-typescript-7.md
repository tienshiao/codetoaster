---
type: Gotcha
title: bun check is TypeScript 7, whatever typescript is installed
description: bun check follows TypeScript 7 rules regardless of the installed typescript package, has no watch mode, and the typescript package stays on 5.x because the 7 package ships no lib files for a tsserver-based editor.
tags: [gotcha, bun, typescript, typecheck]
level: project
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-10T08:37:00Z }
sources:
  - id: claude-md
    resource: ../../CLAUDE.md
    title: CodeToaster CLAUDE.md
    author: human:tienshiao
  - id: task-129
    resource: ../../backlog/tasks/task-129 - Type-check-with-bun-check-instead-of-tsc.md
    title: TASK-129 Type check with bun check instead of tsc
  - id: bun-check-docs
    resource: https://bun.com/docs/runtime/check
    title: bun check
  - id: tsconfig
    resource: ../../tsconfig.json
    title: tsconfig.json
  - id: bun-lock
    resource: ../../bun.lock
    title: bun.lock
---

# What it is

`bun run typecheck` runs `bun check`, the type checker built into Bun since 1.4. It reads `tsconfig.json`, never writes a file, and checks the tree in about a second where `tsc` 5.9.3 took between 10 and 25 depending on how warm the machine was.[^task-129] It is the type half of the [commit gate](/conventions/testing.md).[^claude-md]

# It is TypeScript 7 regardless of node_modules

`bun check` matches one exact TypeScript version, printed by `bun -p process.versions.typescript`, and ignores the `typescript` package.[^bun-check-docs] Two consequences showed up when the repo moved to it:[^task-129]

- A tsconfig option that 7 removed stops the run before any file is checked. `baseUrl` was the one here; `paths` entries start with `./` and resolve against the tsconfig's own directory instead.
- Side-effect imports are checked (TS2882). A stylesheet import such as `import "./DiffView.css"` needs the `declare module "*.css" {}` in `src/globals.d.ts`. `tsconfig.json` names `noUncheckedSideEffectImports` so the 5.x watcher and the editor apply the same rule instead of leaving it to the gate.[^tsconfig]

# Which Bun runs it

Inside a `bun run` script, `bun` resolves to `node_modules/.bin/bun` ahead of the one on `PATH`. That copy is the `bun` npm package. It used to arrive only as `bun-plugin-tailwind`'s peer, at whatever `bun.lock` held, which was 1.3.9; it is now a devDependency at `^1.4.3` so the requirement is written down.[^bun-lock] With the older copy `bun run typecheck` fails with `error: Script not found "check"`, however new the Bun that launched it, so a checkout whose `node_modules` predates the bump needs `bun install` first.

The same pin decides which Bun runs `bun run dev`, `bun run test` and `bun run build:server`, so the bump moved those to 1.4.3 as well.

# No watch mode

`bun check` has no `--watch`, and `bun --watch check` runs once and exits. `bun --hot --check src/index.ts` exists, but it restarts the process on every change and runs nothing while there is a type error, which is not what a server holding live PTYs wants. So `bun run dev` keeps its `tsc --noEmit --watch`.[^task-129]

# Why typescript stays on 5.x

The obvious next step, installing the matching `typescript@7`, breaks editors. The 7 package holds a native `tsc` and nothing else: no `lib/tsserver.js` and no `lib.*.d.ts`. A tsserver-based language server that takes its lib files from the workspace then reports `Cannot find name 'Set'` and `Property 'length' does not exist on type 'string'` on every file. That was observed with 7.0.2 and went away on returning to 5.9.3.[^task-129]

The cost is that the dev watcher and the editor run 5.x rules while the gate runs 7 rules. They agree on this tree today; where they differ, `bun run typecheck` is the one that decides.

[^claude-md]: CodeToaster CLAUDE.md
[^task-129]: TASK-129 Type check with bun check instead of tsc
[^bun-check-docs]: bun check
[^tsconfig]: tsconfig.json
[^bun-lock]: bun.lock
