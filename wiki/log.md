# Wiki Update Log

## 2026-11-24
* **Creation**: [Copying out of a terminal](/modules/terminal-copy.md) for TASK-155: `macOptionClickForcesSelection` for Option-drag on a Mac, the write-only OSC 52 handler and why it is not `@xterm/addon-clipboard`, the secure-context, focus and user-gesture limits on the clipboard write, Option-click options set per press from the mouse tracking mode, and OSC 52 writes taken only by a terminal on screen in a focused window.

## 2026-11-23
* **Creation**: [TaskManager layout](/modules/task-manager-layout.md) for TASK-152: the facade and its fourteen modules, the `TaskHost` rules that keep the split behaviour-preserving (route public calls through the instance, never capture reassignable state, non-async delegators, one owner per piece of state), and a table of every concurrent lifecycle pairing.
* **Update**: [Change watcher and shared watch streams](/modules/change-watcher.md) for TASK-152: the reconcile now cites `src/lib/tasks/checkout-watchers.ts`.
* **Update**: [Archive and unarchive](/modules/archive-and-unarchive.md) for TASK-152: cites `src/lib/tasks/archive.ts`, and its Serialization section points at `inflight.ts` and the layout page.
* **Update**: [Task suspension and the idle harvester](/modules/task-suspension.md) for TASK-152: names `hooks.ts` and `suspend.ts`.
* **Update**: [Bun.$ deadlocks on large git output](/gotchas/bun-shell-deadlock.md) for TASK-154: `gitSpawn` / `gitSpawnRaw` moved from `src/api/utils.ts` to `src/lib/git/spawn.ts`, where the rule and its source now point.
* **Update**: [File listing and ignored files](/modules/file-listing.md) for TASK-154: `listGitFiles`, `listIgnoredEntries`, `buildFileListing` and `safePath` moved from `src/api/utils.ts` to `src/lib/file-listing.ts`.
* **Update**: [Worktree browsing](/modules/worktree-browsing.md) for TASK-154: root resolution, the worktree listing and `rootRoutes` moved from `src/api/utils.ts` to `src/api/roots.ts`.
* **Creation**: [Bun.spawn can run onExit before it returns](/gotchas/bun-spawn-sync-onexit.md) for TASK-151: Bun runs a spawn's `onExit` inside `Bun.spawn` when the child is already gone, which dropped the exit of an agent that died at once; `Pty` now holds an exit nobody heard for its first listener.
* **Update**: [The v2 design system](/conventions/v2-design-system.md) for TASK-153: its Status no longer describes TASK-28 as pending or `routes/shell.tsx` as the preview, and the `components/ui/` rule no longer refers to live v1 code, matching the refreshed CLAUDE.md.
* **Update**: [Response and socket compression](/modules/compression.md) after TASK-150's review: the bundle route answers a matching `If-None-Match` with a 304, the rewritten page's ETag gains a `-bundled` suffix, and the mermaid dynamic import is inlined, which a fixture test now guards.
* **Update**: [Response and socket compression](/modules/compression.md) for TASK-150: its "stay uncompressed" section is replaced by Bundled JS and CSS. It covers why Bun's bundle routes cannot be shadowed, the page rewrite to `/_bundle/`, the fetch-once and encode-once-per-coding cache bounded by the page's names, lazy encoding and its timings, why fonts and nothing inside the bundles need rewriting, dev mode left alone, and the bundle sizes on the wire.
* **Update**: [System load sampler and rail indicator](/modules/system-load.md) after review: a clock step-back restarts the browser's series rather than freezing it, peak and low are taken over the drawn window, high is judged on the figure as shown, the sparkline frame turns warning too, and `wireLoadSampler` is the one socket wiring `server.ts` and the test share.
* **Creation**: [System load sampler and rail indicator](/modules/system-load.md) for TASK-149: the machine-wide CPU delta math and its null cases, the 2 s / 300-sample ring, why the samples are pushed over the terminal socket (history on open, one broadcast per tick) rather than polled, the module store the browser keeps them in, the rail meter's high-load signals, the card's chart, `HoverCardShell`'s new `openOnFocus`/`side`/`align`, and the touch and Linux limits.
* **Creation**: [Task list order and the reorder lockout](/modules/task-list-order.md) for TASK-146: `rankAt` ordering from TASK-116, what counts as a reorder (moves, insertions and removals in the drawn sequence; not in-place updates, first load, remounts or the user's own view changes), the cue on moved rows, and the 500ms click lockout and why it spares portaled dialogs.
* **Update**: [Change watcher and shared watch streams](/modules/change-watcher.md) links the task list's reuse of the change flash.
* **Update**: [Task list order and the reorder lockout](/modules/task-list-order.md) after review: appending or removing at the end does not count, archived rows are data once showing, and a moved project header lights its whole group.
* **Creation**: [Response and socket compression](/modules/compression.md) for TASK-147: the HTTP wrapper's negotiation, threshold, type allowlist and opt-outs, why a streaming route must opt out, the SPA HTML path, the WebSocket's dedicated compressor and why every send asks to compress, why the bundled JS and CSS stay uncompressed, and the before/after measurements.

## 2026-11-22
* **Update**: [The v2 design system](/conventions/v2-design-system.md) gains a section on the `Dialog`'s `subject` slot (TASK-148): a confirmation names its target there, styled apart from the sentence, rather than inside it.
* **Creation**: [Task suspension and the idle harvester](/modules/task-suspension.md) for TASK-145: the three ways a task is suspended, the harvester's guards, where `idle` comes from, and the `background` state a `Stop` reporting running background work maps to, with its 4-hour cap.

## 2026-11-06
* **Update**: [Worktree browsing](/modules/worktree-browsing.md) says who polls the worktree list (TASK-143): the open Explorer and worktree tabs, and the shell only while a worktree is chosen.
* **Update**: [File viewer](/modules/file-viewer.md) and [Diagnose daemon memory](/runbooks/diagnose-daemon-memory.md) for TASK-142: the symbol store's idle and removed-directory sweep, `--symbols-after`, and its counts in `/api/diagnostics` and `status`.
* **Update**: [Worktree browsing](/modules/worktree-browsing.md) says the picker drops a directory the branch already names as whole words, and truncates a long label (TASK-144).

## 2026-11-05
* **Update**: [Archive and unarchive](/modules/archive-and-unarchive.md) says archiving no longer moves a task's project in the sidebar (TASK-141): the per-project `rankAt` on the snapshot, archived tasks included, and how `groupByProject` folds it with the live tasks' ranks.
* **Creation**: [Archive and unarchive](/modules/archive-and-unarchive.md) for TASK-139: what archive keeps, the retention sweep now keeping `wip_at`, the unarchive preview's checkout and snapshot states, the branch-recreate-then-resume sequence and what a late failure leaves, and the serialization against archive.
* **Creation**: [Worktree browsing](/modules/worktree-browsing.md) for TASK-138.2: the `/api/worktrees/<token>` scope and what it refuses, the worktree root kind, the Explorer's picker and its fallback, and tabs keyed and rooted per worktree.
* **Creation**: [Task processes and ports](/modules/task-processes.md) for TASK-138.1: where the tree's roots come from, the one ps and the pid-restricted lsof, how a failed ps and a failed lsof are kept apart, and the polled Processes section.

## 2026-11-04
* **Update**: [Change watcher and shared watch streams](/modules/change-watcher.md) gains a Change highlighting section for TASK-136: frame-driven row pulses and content-compared line flashes, what stays quiet and why, collapsed directories, and the per-path parity that restarts a fade.

## 2026-10-29
* **Update**: [Two test runners](/conventions/testing.md) drops the test-first preference, following CLAUDE.md; its Test first section becomes Test requirements, keeping route-level tests and determinism.
* **Creation**: [Change watcher and shared watch streams](/modules/change-watcher.md) for TASK-135: the streams a task watches, the refcounted WatchPool that shares them per directory, error fan-out and retry, and why there is no watch without a browser.
* **Creation**: [Bun 1.3.9 leaks a directory descriptor per closed fs.watch](/gotchas/bun-fs-watch-descriptor-leak.md): the leak, how a compiled daemon keeps an old Bun, and the rebuild.
* **Creation**: [Diagnose daemon memory](/runbooks/diagnose-daemon-memory.md) for TASK-134: footprint over RSS, `codetoaster status` and `/api/diagnostics`, the threshold log lines, and how to read vmmap's categories for a Bun process.

## 2026-10-13
* **Creation**: [Show in Finder](/modules/show-in-finder.md) for TASK-131: the surfaces that offer it, the one gate, the per-list menu, and the route's refusals from TASK-120.
* **Update**: [File viewer](/modules/file-viewer.md) links its Show in Finder button to the new page.
* **Update**: [Show in Finder](/modules/show-in-finder.md) for TASK-132: the route runs a second `open` that brings Finder to the front, and why `open -R` alone does not.

## 2026-10-10
* **Creation**: [File listing and ignored files](/modules/file-listing.md) for TASK-130: the two git listings, who reads ignored entries, the children route, and how the watcher reports ignored paths.
* **Update**: [Terminal links](/modules/terminal-links.md) drops "a gitignored file is never a link": listed ignored files link, and a path under an ignored directory links on its shape, when the text itself reaches into the directory and no listed file answers to it.
* **Update**: [File viewer](/modules/file-viewer.md) links the Explorer's listing to its new page.
* **Creation**: [bun check is TypeScript 7](/gotchas/bun-check-is-typescript-7.md) for TASK-129: the TS 7 rules it applies, which Bun a `bun run` script resolves, the missing watch mode, and why the `typescript` package stays on 5.x.
* **Update**: [Two test runners](/conventions/testing.md) names `bun run typecheck` in the commit gate in place of `bunx tsc --noEmit`.

## 2026-10-03
* **Update**: [Two test runners](/conventions/testing.md) gains Test first and Before committing sections, from the TDD and pre-commit notes added to CLAUDE.md.
* **Update**: [Commit graph and log pagination](/modules/commit-graph.md) gains a Changes relative to a ref section for TASK-128: the merge-base diff, `diffBase`, and the choice stored as a ref name.
* **Creation**: [File viewer](/modules/file-viewer.md) for TASK-127: the viewer a file tab and a commit's File Tree share, and the commit-scoped symbol index.
* **Update**: [Markdown preview](/modules/markdown-preview.md) says the preview is the same in a commit's File Tree, and gains an At a commit section.
* **Update**: [Markdown preview](/modules/markdown-preview.md) gains a Link URLs section for TASK-126.
* **Update**: [Markdown preview](/modules/markdown-preview.md) gains Headings and Images sections for TASK-124 and TASK-125, with heading, Bitbucket-anchor and image cases added to its test data.
* **Initialization**: Created the OKF v0.2 knowledge bundle for CodeToaster (root [index](/index.md) pinned to `okf_version: "0.2"`, this log, and the `modules/`, `conventions/`, `decisions/`, `gotchas/` and `runbooks/` directories). Compiled by claude-code/claude-opus-5-5 from CLAUDE.md, backlog tasks and the code; every page is `status: draft` pending human review.
* **Creation**: Modules: [Commit graph and log pagination](/modules/commit-graph.md), [Markdown preview](/modules/markdown-preview.md), [Task naming](/modules/task-naming.md), [Terminal links](/modules/terminal-links.md), [Terminal size negotiation](/modules/terminal-size-negotiation.md).
* **Creation**: Conventions: [Two test runners](/conventions/testing.md), [The v2 design system](/conventions/v2-design-system.md), [Wiki maintenance](/conventions/wiki-maintenance.md).
* **Creation**: Decisions: [Vitest for rendering tests only](/decisions/vitest-for-rendering-tests.md).
* **Creation**: Gotchas: [Bun.$ deadlocks on large git output](/gotchas/bun-shell-deadlock.md), [bunfig test options go quiet under bun run](/gotchas/bunfig-test-options-under-bun-run.md), [color-mix over a var() renders opaque](/gotchas/color-mix-over-var.md), [xterm link providers must answer synchronously](/gotchas/xterm-async-link-providers.md).
* **Creation**: Runbooks: [Verify on an isolated server](/runbooks/verify-on-isolated-server.md).
