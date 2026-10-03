# Wiki Update Log

## 2026-10-03
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
