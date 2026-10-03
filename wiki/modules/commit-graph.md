---
type: Module
title: Commit graph and log pagination
description: Graph lanes come from a pure, resumable GraphState so paging stays deterministic, and /git/log detects history drift with after= (409) and seeks with until=.
tags: [git, commit-graph, pagination, frontend]
level: project
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-03T00:50:00Z }
sources:
  - id: commit-graph
    resource: ../../src/frontend/utils/commitGraph.ts
    title: src/frontend/utils/commitGraph.ts
  - id: git-api
    resource: ../../src/api/git.ts
    title: src/api/git.ts
  - id: claude-md
    resource: ../../CLAUDE.md
    title: CodeToaster CLAUDE.md
    author: human:tienshiao
---

# Lanes

The git view draws a lane graph beside the commit list. `assignLanes(commits, state?)` in `utils/commitGraph.ts` is a pure function over commits in `--topo-order` (children before parents): it returns each commit's row — its lane, the edges entering and leaving its dot, the lanes passing through — and a `GraphState` to resume from. Because it is pure and resumable, loading page 3 after pages 1 and 2 yields exactly the lanes that loading all three at once would: contiguous pagination stays deterministic.[^commit-graph] [^claude-md]

`GraphState` is just the list of lanes, each holding the hash it expects next, or null for a free slot. A commit's first parent continues in its lane; further parents fork into a lane already expecting them or the leftmost free one. Closed lanes are reused and lanes never shift left, so the geometry of rows already drawn never changes.[^commit-graph]

# Paging the log

`/git/log` serves pages, and history can move between two of them (a commit, a rebase, a reset in the task's terminal).

- **`after=`** names the last SHA the client already has. If that SHA is no longer where the client thinks it is, the server answers `409 { stale: true }`. The client raises `StaleLogError` and resets the log **once**, outside its retry cycle, so a drifting history does not turn into a retry loop.[^git-api] [^claude-md]
- **`until=`** fetches forward until a given SHA is included, for jumping to a commit that has not been paged in yet. The server caps the rows such a request may return, so a far-off SHA cannot ship a 50k-row payload.[^git-api]

# Showing a commit

The commit detail feeds its per-commit diff to `DiffLayout`, the comment-free core that the code review's `DiffView` also wraps. Read-only consumers pass no comment or expand props, so those affordances do not render.[^claude-md] Commit hashes printed in a terminal open here too; see [terminal links](/modules/terminal-links.md).

[^commit-graph]: src/frontend/utils/commitGraph.ts
[^git-api]: src/api/git.ts
[^claude-md]: CodeToaster CLAUDE.md
