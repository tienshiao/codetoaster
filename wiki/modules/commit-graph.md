---
type: Module
title: Commit graph and log pagination
description: Graph lanes come from a pure, resumable GraphState so paging stays deterministic, /git/log detects history drift with after= (409) and seeks with until=, and a commit's Changes diff can be taken relative to any ref.
tags: [git, commit-graph, pagination, frontend]
level: project
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-03T20:30:00Z }
sources:
  - id: commit-graph
    resource: ../../src/frontend/utils/commitGraph.ts
    title: src/frontend/utils/commitGraph.ts
  - id: git-api
    resource: ../../src/api/git.ts
    title: src/api/git.ts
  - id: commit-detail
    resource: ../../src/frontend/components/git/CommitDetail.tsx
    title: src/frontend/components/git/CommitDetail.tsx
  - id: use-git-commit
    resource: ../../src/frontend/hooks/use-git-commit.ts
    title: src/frontend/hooks/use-git-commit.ts
  - id: diff-base
    resource: ../../src/frontend/utils/diff-base.ts
    title: src/frontend/utils/diff-base.ts
  - id: task-128
    resource: "../../backlog/tasks/task-128 - Commit-tab-Changes-view-choose-what-the-diff-is-relative-to.md"
    title: "TASK-128 — Commit tab Changes view: choose what the diff is relative to"
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

## Changes relative to a ref

A commit tab has three modes: Commit, Changes and File Tree. Commit is always the commit's own diff, from its first parent. Changes shows the same diff by default, and a "Relative to" selector beside the mode switch can point it at any local branch, remote branch or tag instead. That is how a worktree branch is reviewed as a whole: open its tip from the Refs list, switch to Changes, and pick the branch it was cut from.[^commit-detail] [^task-128]

- **Merge base, not the ref's tip.** `/git/commit?sha=&base=` diffs from `git merge-base base sha` to `sha`, the same as `git diff base...sha`. A base that has moved on since the branch left it would otherwise show its own later work as deleted. Two histories with no common commit compare directly.[^git-api]
- **`diffBase`.** The response names the commit the old side was read from: the first parent, the merge base, or null for a root commit. Image previews and `/diff-tokens` (through its own `base`) read their old side from it, so highlighting matches the diff on screen.[^git-api] [^use-git-commit]
- **A name is stored, a sha is sent.** The choice lives in the commit tab's view state as `<kind>:<name>` (`branch:v2`) and is resolved against `/git/refs` on every render. The diff follows a branch that moves, each (sha, base) answer stays immutable in the query cache, and a ref that was deleted reads as "Parent commit" again. The stored choice is dropped once `/git/refs` has answered without it, so a later branch reusing the name does not take the tab over.[^diff-base] [^commit-detail]
- **A diff that fails is an error.** The route diffs with `git diff-tree` (plumbing, so the user's diff config and external drivers do not apply), under a timeout, and answers 500 when git fails. A failed diff shown as empty would read as "no changes", and the client caches the answer per (sha, base).[^git-api]

[^commit-graph]: src/frontend/utils/commitGraph.ts
[^git-api]: src/api/git.ts
[^commit-detail]: src/frontend/components/git/CommitDetail.tsx
[^use-git-commit]: src/frontend/hooks/use-git-commit.ts
[^diff-base]: src/frontend/utils/diff-base.ts
[^task-128]: TASK-128 — Commit tab Changes view: choose what the diff is relative to
[^claude-md]: CodeToaster CLAUDE.md
