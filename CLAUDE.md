
# CodeToaster

Browser-based workspace for coding-agent tasks. A task runs an agent (Claude Code
by default, or another profile) in a PTY, usually in a git worktree of its own,
with shell terminals, a diff, files and history beside it. A daemon owns the
PTYs and pushes them over one WebSocket, and several browsers can attach to the
same task at once.

## Project Structure

```
src/
  index.ts              # CLI entry point
  server.ts             # Bun.serve() setup (HTTP, WebSocket, HTML imports)
  cli/                  # CLI commands, daemon management, agent hook relay
  api/                  # HTTP routes: tasks, diff, files, git, worktrees, backlog, uploads, ...
  api/roots.ts          # Task/project/worktree root resolution; rootRoutes registers a route under each
  api/untracked-diff.ts # Untracked files' diff through a scratch intent-to-add index
  api/utils.ts          # Generic helpers: cachedPromise, coalesce, mapWithConcurrency, parseNonNegInt
  api/compress.ts       # Response compression; bundles.ts serves the compressed JS/CSS
  lib/git/spawn.ts      # gitSpawn/gitSpawnRaw: every git invocation goes through these
  lib/file-listing.ts   # Repository file listing (tracked, untracked, ignored), safePath, image MIME types
  lib/db.ts             # bun:sqlite (projects, tasks) with migrations
  lib/tasks/            # TaskManager: task lifecycle, suspend/resume, archive, harvester, watchers
  lib/agent/            # Agent profiles, spawn command, hook state, transcripts
  lib/worktree/         # Per-task git worktrees: create, WIP snapshots, restore, evict, reconcile
  lib/xtmux/            # PTYs, terminal naming, WebSocket message types and send helpers
  lib/highlight/        # Server-side tree-sitter tokenizing, grammar registry, cache
  lib/symbols/          # Per-repo symbol index (tree-sitter tags) and store
  lib/backlog/          # Reading Backlog.md tasks for the Explorer
  lib/diff/             # Oversized-diff placeholder shared by server and client
  lib/*.ts              # Daemon-wide services: diagnostics, processes, system load, uploads
  frontend/
    index.html          # HTML entry point (Bun HTML import)
    frontend.tsx        # React root
    TaskContext.tsx     # Global state: tasks, projects, WebSocket, activity
    PtyContext.tsx      # Per-PTY routing over the one socket (pty-router.ts)
    Terminal.tsx        # @xterm/xterm wrapper
    DiffView.tsx        # Code review diff (comments/symbols over DiffLayout)
    layout-store.ts     # Each task's tab layout: tabs, split groups, focus
    view-state-store.ts # Per-task UI state that survives tab unmounts
    components/         # Task sidebar, TaskShell, Explorer, Composer, dialogs, palette
    components/tabs/    # TabArea and its panes (agent, shell, file, diff, history, commit)
    components/diff/    # Diff viewer; DiffLayout is the shared read-only core
    components/file/    # File tree, content, markdown/mermaid preview
    components/git/     # Commit list, graph, detail, ref sidebar
    components/ui/      # shadcn/ui primitives left from v1 (do not grow)
    components/v2/      # The v2 design system: shell components + AppShell
    hooks/              # React hooks (WebSocket, theme, git queries, etc.)
    lib/                # cn() helper, attachment uploads, agent options
    utils/              # Diff parsing, commit graph lanes, ref tree, slugs, link matching
    routes/             # TanStack Router file-based routes
    types/              # Frontend-only type definitions
  types/                # Types shared by server and frontend
```

## Running

```sh
bun run dev          # tsr watch + bun --hot src/index.ts
bun run start        # NODE_ENV=production bun src/index.ts
bun run build:server # Build standalone binary for current platform
bun run typecheck    # bun check: the whole tree in about a second
```

`bun check` is Bun's own type checker and follows TypeScript 7 rules whatever
`typescript` is installed, so `tsconfig.json` has to stay valid for 7 (no
`baseUrl`; `paths` entries start with `./`). Inside a `bun run` script `bun` is
`node_modules/.bin/bun`, not the one on `PATH`, which is what the `bun`
devDependency pins: a `node_modules` holding an older one answers
`Script not found "check"` until `bun install`. It has no watch mode, which is why
`bun run dev` still runs `tsc --watch`, and the `typescript` package stays on
5.x because a tsserver-based editor reads its `lib.*.d.ts` from there and the 7
package does not ship them.

## CLI

Entry point is `src/index.ts` using `util.parseArgs`. In daemon mode, spawns a background process managed via PID file in `~/.codetoaster/`. CLI commands communicate with the running server over HTTP.

## Tech Stack

- **Runtime:** Bun (not Node)
- **Server:** `Bun.serve()` with WebSocket and HTML imports
- **Frontend:** React 19, TanStack Router (file-based), Tailwind CSS 4, shadcn/ui
- **Terminal:** `@xterm/xterm` (client), `@xterm/headless` (server-side state)
- **PTY:** `Bun.spawn()` with `pty: true`
- Route tree is auto-generated by `@tanstack/router-cli` (`tsr`) - don't edit `routeTree.gen.ts`

## Bun Conventions

Default to Bun instead of Node.js.

- `bun <file>` not `node`/`ts-node`
- `bun test` not `jest`/`vitest`
- `bun install` not `npm`/`yarn`/`pnpm install`
- `bun run <script>` not `npm run`
- `bunx` not `npx`
- Bun auto-loads `.env` - don't use dotenv

### Bun APIs (prefer over third-party)

- `Bun.serve()` with routes/WebSocket - not `express`/`ws`
- `bun:sqlite` - not `better-sqlite3`
- `Bun.file()` - not `node:fs` readFile/writeFile
- `Bun.$\`cmd\`` - not `execa`

Exception: git invocations go through `gitSpawn`/`gitSpawnRaw` in `lib/git/spawn.ts`, which use `Bun.spawn`. `Bun.$` buffers output in a shell and deadlocks on large payloads (e.g. diffing many large untracked files).

## WebSocket Protocol

`ClientMessage` and `ServerMessage` in `src/lib/xtmux/types.ts` are the source
of truth; read them rather than a list here. In outline:

- The socket carries terminal I/O for every PTY a browser shows (`attach`,
  `input`, `resize`, `data`, `restore`, `exit`), the task list and its changes
  (`tasks`, `task`, `activity`, `notification`, `changed`), project edits and
  sidebar order, and the system load feed (`loadHistory`, `load`).
- Creating, resuming, suspending, archiving and deleting a task are HTTP routes
  under `/api/tasks` (`src/api/tasks.ts`), not socket messages; the result
  reaches every browser as a `task` or `tasks` frame.
- Server frames go out through `sendFrame` in `src/lib/xtmux/socket.ts`, which
  compresses them ([compression](wiki/modules/compression.md)).

## Key Patterns

- Task URLs are `/t/{slugified-title}-{uuid}` (`routes/t.$slug.tsx`,
  `utils/slug.ts`). Lookup keys off the last 36 characters, so a rename only
  alters the slug cosmetically, and `?tab=<tabKey>` opens or focuses a tab.
- A task's label is derived server-side in `lib/xtmux/naming.ts`: the stored
  title is a stable `{dir} · {branch}` label (the slug and the CLI's name
  matching build off it) and only a manual rename replaces it. The *displayed*
  label is projected at render time by `sessionDisplayNames`: an explicit
  rename, else the live terminal title (OSC 0/2) when it carries real content
  and is unique across tasks, else the stored title. Nothing is latched.
  `naming.ts` is import-free so the frontend can share the projection
  ([task naming](wiki/modules/task-naming.md))
- A task's tabs (agent, shells, files, diffs, history, commits) live in a
  per-task layout in `layout-store.ts`, drawn by `components/tabs/TabArea.tsx`
  with one pane component per kind in `components/tabs/panes/`
- Terminal size negotiation: smallest-wins across all connected clients
  ([terminal size negotiation](wiki/modules/terminal-size-negotiation.md))
- Server maintains authoritative terminal state via `@xterm/headless` + serialization addon
- The frontend routes socket frames per PTY (`pty-router.ts`) and queues a
  PTY's frames until its terminal is mounted
- A PTY counts as idle after 300ms of silence; that edge drives task activity,
  and the sidebar order moves only on a wake after a quiet gap
  ([task list order](wiki/modules/task-list-order.md))
- Diff view: unified diff parser with word-level highlighting, inline comments, syntax tokenization
- `DiffLayout` is the comment-free diff core (file tree, all/single toggle, keyboard nav); `DiffView` wraps it with comments/submit/symbols, and the commit view (`components/git/CommitDetail.tsx`) feeds it per-commit state. Read-only consumers pass no comment/expand props, so those affordances don't render.
- History: commit graph lanes are assigned by a pure, resumable `GraphState` in `utils/commitGraph.ts` so contiguous pagination stays deterministic
- `/git/log` uses `after=` drift detection (409 → `StaleLogError`, reset once outside the retry cycle) and `until=` seek for fetch-until-SHA
- UI state that must survive tab unmounts lives in `view-state-store.ts` keyed by task, not component state

## Testing

```ts
import { test, expect } from "bun:test";
```

**Two runners, split by whether the test renders.** The rule is the filename,
and it is the filename precisely so nothing has to be configured to keep the two
apart:

| file | runner | command |
| --- | --- | --- |
| `*.test.ts` — everything that does not mount a component | `bun test` | `bun run test:unit` |
| `*.render.tsx` — anything calling `render()` / `renderHook()` | Vitest, `environment: happy-dom` | `bun run test:render` |

`bun run test` runs both, and is what CI and a pre-commit check should use.

`*.render.tsx` deliberately does not contain `.test`, so `bun test` does not
discover it: Bun requires `.test`/`.spec` in the name, so a suffix without one
is invisible to it and no ignore flag has to hold. (Do not "fix" this by
renaming them to `.test.tsx`. `--path-ignore-patterns` and `bunfig`'s
`pathIgnorePatterns` both work from a shell but are silently ignored under
`bun run`, so the exclusion would hold when you tested it by hand and fail in
CI.)

Vitest exists here for one reason: a rendering test needs a DOM, Bun has no
per-file test environment, and its `preload` is global — so the only way to give
the frontend a `document` from inside `bun test` is to give the server one too
and then hand back the `fetch`/`Request`/`Response` its route tests compare by
identity. Scoping by runner means the server tests never see a DOM at all.
`vitest.config.ts` mirrors `tsconfig`'s `@/*` alias; if one moves the other has
to, because a test resolving a module differently from the app is the one real
hazard of two bundlers over one tree.

**No test spawns the real agent.** `buildAgentCommand` falls back to `claude`,
so a test that creates a task and stands nothing in starts a real Claude Code
session — a transcript on disk and tokens spent, per test — and fails outright
on a machine that has no `claude`. `test/preload.ts` (wired through `bunfig.toml`'s
`[test] preload`, and from `test/setup-rendering.ts` for the other runner) points
`CODETOASTER_AGENT_BIN` at `test/fake-agent.sh` **before every test**, so no file
has to remember and a new one inherits it.

Before every test, not once, and unconditionally — both of which took a bug to
get right. Files move that variable around: one `delete`s it in an `afterEach`
so its own stand-in does not leak, another sets one and never puts it back.
Either leaves the *next* file with something that is not the default, which is
how a suite that looks protected starts spawning real agents halfway through a
run. A file that needs a different agent — one recording its argv, one that
fails, one that is not there — sets the variable from its own `beforeEach` or
its test body, which run after the global hook. Setting it in a `beforeAll` no
longer works, and `spawn.test.ts` is the worked example: it asserts the bare
`claude` fallback, so it clears the variable per test.

`agent-bin.test.ts` guards the guard. The protection is a line in `bunfig.toml`,
and bunfig's test options are exactly the ones that go quiet under `bun run`
(see the runner note above), so a lapse would otherwise be silent. That file
fails with `Received: "claude"` instead.

Reach for a rendering test when the behaviour is a *lifecycle* one — when a
subscription binds, when a ref is written, what survives a remount. Pure logic
belongs in a `.test.ts` against the function that holds it, which is why
`drag.ts` and `layout-store.ts` exist apart from the components using them.
Happy DOM has no layout engine, so anything depending on real geometry has to
stub it (see `TabArea.render.tsx`) and is better verified in a browser via the
`verify` skill.

### Test requirements

- **API routes** (`src/api/`): every new or changed route has route-level tests
  through a real `Bun.serve` on port 0, in addition to unit tests of whatever it
  calls; `tasks.test.ts` is the worked example. They cover the happy path and
  the common error cases: validation failure (400), not found (404), conflict
  (409). Unit tests do not exercise param and body parsing or the status codes
  and error bodies a client actually gets, so these are not optional. There is
  no authentication or per-role authorization to cover: the daemon's one guard
  is the origin check, which `guardApiRoutes` applies to the whole route table
  and `origin.test.ts` covers. A route mounted outside that table needs its own
  refusal test.
- **Keep tests deterministic.** Inject the clock (a `now: () => number`
  dependency, as `symbols/store.ts` takes one) rather than reading `Date.now()`
  in the code under test. The fake agent above stands in for every task. Wait on
  a condition with `waitFor` from `test/wait.ts`, not a bare sleep, and build git
  fixtures with `test/git-repo.ts`.

## Before committing a code change

Run `/code-review --fix` first, then `/verify`. Commit only when all of these
hold:

- `bun run test` and `bun run typecheck` are clean.
- `/verify` (`.claude/skills/verify/SKILL.md`) has driven the change on an
  isolated server: the endpoint answers as intended, or the UI does in a real
  browser.
- The change has its tests, and its Backlog task and wiki pages are
  up to date.

If any of them reports a gap, fix it through normal editing and run it again.
Summarize both results, the review's and the verification's, in the Backlog
task's final summary, and in the PR description when there is one. Commits that
touch only docs, the wiki or `backlog/` skip this.

## Frontend

Uses Bun HTML imports with `Bun.serve()` - not Vite. HTML files import `.tsx` directly. Tailwind via `bun-plugin-tailwind`.

For Bun API docs: `node_modules/bun-types/docs/**.mdx`

## The v2 design system is the new UI

`components/v2/` is the UI. The task list, tab bar, Explorer and composer are
composed from it, every route renders inside `AppShell` (through
`components/TaskShell.tsx` in `routes/__root.tsx`), and the v1 scaffolding it
replaced is gone.

So when building new frontend work:

- Compose from `components/v2/`. What is left of `components/ui/` (shadcn) is
  a handful of primitives some v2 components and older views still wrap; do not
  grow it.
- `AppShell` is layout only. Every list, tab and status value arrives as a
  prop, so the wiring tasks supply data rather than restructure markup.
- Use the semantic tokens (`bg-pane`, `text-state-busy`, `h-row`, `text-micro`,
  `bg-selected`) and never a colour literal. The raw `--ct-*` palette is not
  component vocabulary.
- The source of truth is the Claude Design project "CodeToaster v2 Design
  System" (`06f63995-570a-486c-af82-d70b8fa5976b`) — distinct from the older
  `.design-sync/` pipeline, which pushes the *v1* component surface upward.
- Before editing the token layer in `index.css`, read the comment above the
  palette block: transparent washes must be `oklch(var(--ct-x-ch) / <alpha>)`,
  because a `color-mix()` over a `var()` does not survive bundling and renders
  fully opaque.

## Knowledge wiki (`wiki/`)

`wiki/` is this repo's own knowledge base, an OKF v0.2 bundle kept in the
LLM-wiki style: compiled from this file, `backlog/` and the code, which are
never edited during wiki work.

- For a question about how something works or why, read `wiki/index.md`
  first, then only the pages it points to. When a page and the code disagree,
  trust the code and fix the page.
- After a change that alters a convention, a decision or a subsystem's design:
  update the affected pages and `wiki/index.md`, and append to `wiki/log.md`,
  in the same commit. Set touched pages to `status: draft` and refresh
  `generated.at`; never add `verified` to your own work.
- Links between pages are bundle-relative (`/gotchas/bun-shell-deadlock.md`).
  `wiki-links.test.ts` fails on any that does not resolve.
- The wiki is a lower trust tier than this file. Full schema and the ingest,
  query and lint procedures: `wiki/conventions/wiki-maintenance.md`.

## Model delegation when running as Fable

If the task's complexity does not require Fable to solve, do the planning/analysis with Fable, then delegate the execution/implementation to a subagent running Opus (pass `model: "opus"` on the Agent call). Reserve Fable itself for the genuinely hard parts (e.g. smallest-wins terminal size negotiation across multiple clients, unified diff parsing edge cases in `parseDiff.ts` (renames, path quoting, binary files), commit-graph lane assignment, and PTY/session lifecycle logic in `lib/xtmux/`).

<!-- BACKLOG.MD GUIDELINES START -->
<CRITICAL_INSTRUCTION>

## Backlog.md Workflow

This project uses Backlog.md for task and project management.

**For every user request in this project, run `backlog instructions overview` before answering or taking action.**

Use the overview to decide whether to search, read, create, or update Backlog tasks.

Use the detailed guides when needed:
- `backlog instructions task-creation` for creating or splitting tasks
- `backlog instructions task-execution` for planning and implementation workflow
- `backlog instructions task-finalization` for completion and handoff

Use `backlog <command> --help` before running unfamiliar commands. Help shows options, fields, and examples.

Do not edit Backlog task, draft, document, decision, or milestone markdown files directly. Use the `backlog` CLI so metadata, relationships, and history stay consistent.

</CRITICAL_INSTRUCTION>
<!-- BACKLOG.MD GUIDELINES END -->
