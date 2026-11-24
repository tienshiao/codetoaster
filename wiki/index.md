---
okf_version: "0.2"
---

# Modules

* [Archive and unarchive](modules/archive-and-unarchive.md) - Archive snapshots a task's worktree to a WIP ref kept 30 days and deletes the branch only when merged or pushed; unarchive recreates a deleted branch from the snapshot's parent, the remote or the base, flips the row to suspended, and resumes it through the ordinary restore.
* [Change watcher and shared watch streams](modules/change-watcher.md) - Each live task's TaskWatcher folds file and ref events into changed batches for the browser, over fs.watch streams shared per directory through a refcounted WatchPool, and only while a browser is connected; the browser refetches what they stale and flashes the rows and lines that changed.
* [Commit graph and log pagination](modules/commit-graph.md) - Graph lanes come from a pure, resumable GraphState so paging stays deterministic, /git/log detects history drift with after= (409) and seeks with until=, and a commit's Changes diff can be taken relative to any ref.
* [File listing and ignored files](modules/file-listing.md) - One git listing feeds the Files tree, terminal links and file search; ignored entries are in it collapsed to the directory, and an ignored directory's children load one level at a time when it is opened.
* [File viewer](modules/file-viewer.md) - A file tab and a commit's File Tree draw a file with the same viewer; the tab reads the working tree, the tree reads one commit, including its own symbol index.
* [Markdown preview](modules/markdown-preview.md) - A file tab renders markdown with GFM, mermaid diagrams and a frontmatter header; its links open the files and headings they name, and its images load from the repository.
* [Response and socket compression](modules/compression.md) - API responses and the SPA's HTML above 1 KiB are compressed with br, zstd or gzip as Accept-Encoding allows, the bundled JS and CSS are served compressed from a route the rewritten page points at, encoded once per coding and cached, and the terminal WebSocket negotiates permessage-deflate with a per-socket window and compresses every frame.
* [Show in Finder](modules/show-in-finder.md) - A file tab, a working-tree diff's file headers and the Explorer's rows can show a path in Finder on the daemon's Mac; one hook gates every surface to a desktop Mac browser at a loopback host, and the route refuses anything else.
* [System load sampler and rail indicator](modules/system-load.md) - One daemon-wide sampler reads machine CPU from os.cpus() deltas and os.loadavg() every 2 seconds into a 10-minute ring, sends the ring to each socket as it opens and pushes every tick to all clients; the right rail shows the figure with a sparkline, and a hover or focus card charts the window with the load averages.
* [Task processes and ports](modules/task-processes.md) - The Explorer's Processes section shows the process tree under a task's terminals and the TCP ports each process listens on, read per request from one ps and one pid-restricted lsof, and polled while the section is open.
* [Task suspension and the idle harvester](modules/task-suspension.md) - A task is suspended on daemon restart, by the user, or by the harvester after 30 idle minutes with nobody watching and nothing running; a turn that ended with background work still running is held for up to 4 hours.
* [TaskManager layout](modules/task-manager-layout.md) - TaskManager is the one entry point for tasks, a facade of non-async delegators over one class per concern in src/lib/tasks; modules reach each other through a TaskHost that is the manager itself, and the five in-flight maps that serialize resume, suspend, evict, archive and unarchive live together in inflight.ts.
* [Task naming](modules/task-naming.md) - A task's stored name is a stable "<dir> · <branch>" label used for slugs and CLI matching, while the displayed label is projected at render time from a rename, the live terminal title, or the stored name.
* [Task list order and the reorder lockout](modules/task-list-order.md) - The sidebar's task list is sorted by rankAt, which moves only when a task wakes after a quiet gap; when the drawn order still changes (a rank move, a task added or leaving), the rows that moved flash and the list ignores clicks for 500ms so a row that slid under the pointer cannot be opened or archived by mistake.
* [Copying out of a terminal](modules/terminal-copy.md) - Option-drag forces a local selection on a Mac while a program has the mouse, and a program's own OSC 52 copy is written to the browser's clipboard; OSC 52 reads are swallowed unanswered.
* [Terminal links](modules/terminal-links.md) - Task ids, file paths, bare file names and commit hashes in a task's terminals are xterm links that open a task file, a file tab or a commit, each matched by a DOM-free provider.
* [Terminal size negotiation](modules/terminal-size-negotiation.md) - When several browsers attach to one PTY, the terminal takes the smallest measured cols and rows across clients, ignoring clients that have not measured or reported garbage.
* [Worktree browsing](modules/worktree-browsing.md) - The Explorer lists the worktrees of a task's repository and can point Changes, Files, History, Refs and Backlog at any of them; the routes serve a worktree through a token naming its base root and path, and refuse a path that is not one of that repository's live worktrees.

# Conventions

* [Two test runners, split by filename](conventions/testing.md) - Non-rendering tests run under bun test as *.test.ts, rendering tests run under Vitest with happy-dom as *.render.tsx, and no test ever spawns the real agent.
* [The v2 design system](conventions/v2-design-system.md) - Frontend work composes from components/v2 with semantic tokens only; AppShell is layout-only, every route renders inside it, and the v1 scaffolding is gone.
* [Wiki maintenance](conventions/wiki-maintenance.md) - How this wiki is structured, written, reviewed and linted.

# Decisions

* [Vitest for rendering tests only](decisions/vitest-for-rendering-tests.md) - Rendering tests run under Vitest with happy-dom because Bun has no per-file test environment, and a global DOM preload would break the server tests.

# Gotchas

* [bun check is TypeScript 7, whatever typescript is installed](gotchas/bun-check-is-typescript-7.md) - bun check follows TypeScript 7 rules regardless of the installed typescript package, has no watch mode, and the typescript package stays on 5.x because the 7 package ships no lib files for a tsserver-based editor.
* [Bun 1.3.9 leaks a directory descriptor per closed fs.watch](gotchas/bun-fs-watch-descriptor-leak.md) - On Bun 1.3.9 every fs.watch, recursive or not, keeps its directory descriptor open after close(); 1.4.x does not, and a compiled daemon keeps the Bun it was built with until it is rebuilt.
* [Bun.spawn can run onExit before it returns](gotchas/bun-spawn-sync-onexit.md) - When the child is already gone by the time Bun.spawn finishes, Bun runs onExit synchronously inside the call, so Pty holds an exit nobody heard and hands it to the first listener on a microtask.
* [Bun.$ deadlocks on large git output](gotchas/bun-shell-deadlock.md) - Bun's shell buffers output and deadlocks on large payloads, so every git invocation goes through gitSpawn/gitSpawnRaw, which use Bun.spawn.
* [bunfig test options go quiet under bun run](gotchas/bunfig-test-options-under-bun-run.md) - --path-ignore-patterns and bunfig's pathIgnorePatterns work from a shell but are silently ignored under bun run, so anything the test suite depends on must not rest on them.
* [color-mix over a var() renders opaque](gotchas/color-mix-over-var.md) - Tailwind emits a color-mix over a CSS variable as an opaque fallback plus a nested @supports override that Bun's CSS bundler drops, so washes must be written oklch(var(--ct-x-ch) / alpha).
* [xterm link providers must answer synchronously](gotchas/xterm-async-link-providers.md) - A link provider whose provideLinks callback fires later underlines on hover but does nothing on click, because xterm captures the link on mousedown.

# Runbooks

* [Diagnose daemon memory](runbooks/diagnose-daemon-memory.md) - Read the daemon's real footprint, its peak and when it was reached, its descriptors and what it is holding from codetoaster status or GET /api/diagnostics, and find threshold crossings in its log.
* [Verify on an isolated server](runbooks/verify-on-isolated-server.md) - Check a change at runtime from a second server on its own port and database, driving tasks with the shell profile so no real agent starts.
