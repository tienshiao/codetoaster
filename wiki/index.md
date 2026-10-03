---
okf_version: "0.2"
---

# Modules

* [Commit graph and log pagination](modules/commit-graph.md) - Graph lanes come from a pure, resumable GraphState so paging stays deterministic, and /git/log detects history drift with after= (409) and seeks with until=.
* [File viewer](modules/file-viewer.md) - A file tab and a commit's File Tree draw a file with the same viewer; the tab reads the working tree, the tree reads one commit, including its own symbol index.
* [Markdown preview](modules/markdown-preview.md) - A file tab renders markdown with GFM, mermaid diagrams and a frontmatter header; its links open the files and headings they name, and its images load from the repository.
* [Task naming](modules/task-naming.md) - A task's stored name is a stable "<dir> · <branch>" label used for slugs and CLI matching, while the displayed label is projected at render time from a rename, the live terminal title, or the stored name.
* [Terminal links](modules/terminal-links.md) - Task ids, file paths, bare file names and commit hashes in a task's terminals are xterm links that open a task file, a file tab or a commit, each matched by a DOM-free provider.
* [Terminal size negotiation](modules/terminal-size-negotiation.md) - When several browsers attach to one PTY, the terminal takes the smallest measured cols and rows across clients, ignoring clients that have not measured or reported garbage.

# Conventions

* [Two test runners, split by filename](conventions/testing.md) - Non-rendering tests run under bun test as *.test.ts, rendering tests run under Vitest with happy-dom as *.render.tsx, and no test ever spawns the real agent.
* [The v2 design system](conventions/v2-design-system.md) - New frontend work composes from components/v2 with semantic tokens only; AppShell is layout-only and replaces App.tsx in TASK-28.
* [Wiki maintenance](conventions/wiki-maintenance.md) - How this wiki is structured, written, reviewed and linted.

# Decisions

* [Vitest for rendering tests only](decisions/vitest-for-rendering-tests.md) - Rendering tests run under Vitest with happy-dom because Bun has no per-file test environment, and a global DOM preload would break the server tests.

# Gotchas

* [Bun.$ deadlocks on large git output](gotchas/bun-shell-deadlock.md) - Bun's shell buffers output and deadlocks on large payloads, so every git invocation goes through gitSpawn/gitSpawnRaw, which use Bun.spawn.
* [bunfig test options go quiet under bun run](gotchas/bunfig-test-options-under-bun-run.md) - --path-ignore-patterns and bunfig's pathIgnorePatterns work from a shell but are silently ignored under bun run, so anything the test suite depends on must not rest on them.
* [color-mix over a var() renders opaque](gotchas/color-mix-over-var.md) - Tailwind emits a color-mix over a CSS variable as an opaque fallback plus a nested @supports override that Bun's CSS bundler drops, so washes must be written oklch(var(--ct-x-ch) / alpha).
* [xterm link providers must answer synchronously](gotchas/xterm-async-link-providers.md) - A link provider whose provideLinks callback fires later underlines on hover but does nothing on click, because xterm captures the link on mousedown.

# Runbooks

* [Verify on an isolated server](runbooks/verify-on-isolated-server.md) - Check a change at runtime from a second server on its own port and database, driving tasks with the shell profile so no real agent starts.
