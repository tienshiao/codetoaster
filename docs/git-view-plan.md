# Git View — Implementation Plan

A read-only, GitX/Fork-style git viewer as a fourth session tab, alongside terminal / diff / file.

## Settled design decisions

- **Read-only.** No fetch/pull/push/checkout/stash/commit. The view never mutates the repo.
- **All-refs log.** The commit list shows `git log --all --topo-order` — every branch head is always present in the list.
- **Sidebar is pure navigation.** Clicking a branch/tag selects its head commit in the commit list (scrolling to it), it does not filter the log or check anything out.
- **Single-SHA selection.** The selected commit drives the bottom pane. The bottom-pane mode (commit / changes / tree) persists independently of selection.
- **URL-driven state:** `?commit=<sha>&mode=<mode>` (plus `&file=` in tree mode), matching the file view's `?file=` pattern. Deep links and back/forward work.
- **Consistent graph.** Pagination is strictly contiguous (no jump-and-backfill). Selecting a far-away branch head fetches pages *through* to that SHA in one request, so lane assignment is deterministic top-down.
- **Merge commits diff against the first parent** (`git diff <sha>^1 <sha>`), with all parents linked in the header.
- **"Local Changes" pinned row** at the top of the commit list links to the existing diff tab — no duplicate uncommitted-changes UI inside the git view.

## UI layout

```
┌──────────┬──────────────────────────────────────────────┐
│ Filter □ │  Local Changes                               │
│ Branches │  ◉─╮  subject        refs      author  date  │  CommitList
│  main    │  │ ◉  subject                  author  date  │  (virtualized,
│  feat/x  │  ◉─╯  subject        [main]    author  date  │   graph column)
│ Remotes  │  …                                           │
│ Tags     ├──────────────────────────────────────────────┤
│          │  [Commit] [Changes] [File Tree]              │  CommitDetail
│          │  …mode content…                              │
└──────────┴──────────────────────────────────────────────┘
```

Sidebar (~240px, filterable) · top: commit list with graph · bottom: detail pane. Horizontal split between top/bottom is draggable (persist ratio in view-state).

## Server API

All endpoints follow the existing pattern: `resolveSessionGitRoot(sessionId)` (src/api/utils.ts) → `git -C <dir> …` via `Bun.spawn` for potentially large output. New file: `src/api/git.ts`, registered in `src/server.ts` routes.

**Input validation:** SHAs must match `/^[0-9a-f]{4,40}$/i`; ref names are only ever *returned* by us, never accepted as free-form input except through `git rev-parse --verify` with a leading `--` guard. Never interpolate user input into option position.

### `GET /api/sessions/:id/git/log?skip=<n>&limit=<n>&until=<sha>`

```
git log --all --topo-order --skip=<n> -n <limit> \
  --format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1e
```

Fields split on `\x1f`, records on `\x1e`. Response rows: `{ hash, parents: string[], refs: string[], author, email, date, subject }`.

- Default `limit` ~200. With `until=<sha>`, the server ignores `limit` and streams rows until the target SHA has been emitted (the fetch-until-SHA fast path for sidebar clicks), with a hard cap (~50k rows) → if exceeded, return `{ truncated: true }` and the client shows a "ref is very deep in history" notice.
- **Drift detection:** the client sends `skip` = number of rows it has, and the first row's expected predecessor via `after=<lastSha>`; server fetches from `skip-1` and verifies row 0 matches `after`. Mismatch (new commits arrived, refs moved) → `409 { stale: true }` → client resets to page 1. Simple and correct; ref changes invalidate the window anyway.

### `GET /api/sessions/:id/git/refs`

`git for-each-ref --format='%(refname)%1f%(objectname)%1f%(*objectname)' refs/heads refs/remotes refs/tags` plus `git symbolic-ref -q HEAD` / `git rev-parse HEAD`.

Response: `{ head: { ref, sha }, branches: [{name, sha}], remotes: [{name, sha}], tags: [{name, sha}] }` (tags use the peeled `%(*objectname)` when present so annotated tags resolve to commits). Include a `hash` of the whole payload for cheap staleness checks.

### `GET /api/sessions/:id/git/commit?sha=<sha>`

Metadata: `git show -s --format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ct%x1f%D%x1f%B <sha>`.
Diff text, same string shape as `/api/sessions/:id/diff` so `parseDiff` consumes it unchanged:

- non-merge: `git diff-tree --patch --root -M <sha>`
- merge: `git diff -M <sha>^1 <sha>`

Response: `{ meta: {...}, diff: string, hash }`. Serves both Commit mode and Changes mode.

### `GET /api/sessions/:id/git/tree?sha=<sha>`

`git ls-tree -r -z --name-only <sha>` → same `{ files, directory }` shape as `/api/sessions/:id/files` so the file-view tree component is reusable as-is.

### `GET /api/sessions/:id/git/file?sha=<sha>&file=<path>`

`git show <sha>:<path>` (pattern already exists in `src/lib/highlight/gitContent.ts` and the `image/git` endpoint). Same `FileContentResponse` shape as `/api/sessions/:id/file`, including server tree-sitter tokens. Images route to the existing `image/git?ref=` endpoint.

### Extend `POST /api/sessions/:id/diff-tokens` with optional `sha`

Today new-side reads the working tree and old-side reads `:0:` / `HEAD:`. With `sha` present: new = `git show <sha>:<path>`, old = `git show <sha>^1:<path>` (root commit → old side null). Without `sha`, behavior is unchanged.

## Frontend

### Tab & route wiring (the known five-spot change)

1. `types/tab.ts`: `TabType = "terminal" | "diff" | "file" | "git"`.
2. New route `routes/sessions.$slug.git.tsx` with `validateSearch: { commit?: string, mode?: "commit" | "changes" | "tree", file?: string }` (tsr regenerates `routeTree.gen.ts`).
3. `App.tsx` `currentTab` detection (~line 56): add `/sessions/$slug/git`.
4. `utils/session-nav.ts`: extend `SessionNavTarget` union + `tabNavTarget`; restore last-selected commit/mode from view-state like the file tab restores `selectedFile`.
5. Tab button in `TopBar` / `TabSwitcher`.
6. `view-state-store.ts`: add `gitView: { commit?, mode, splitRatio }` per session.

### New components — `src/frontend/components/git/`

- **`GitView.tsx`** — layout, split pane, data orchestration; the route renders `<GitView key={id} sessionId={id} />` per the established remount convention.
- **`RefSidebar.tsx`** — collapsible Branches / Remotes / Tags sections, filter input (client-side substring match), current branch marked. Click → `selectCommit(sha)`.
- **`CommitList.tsx`** — virtualized rows (`@tanstack/react-virtual`, new dep) over `useInfiniteQuery`; columns: graph cell, subject + ref badges, author, relative date. Pinned "Local Changes" row navigates to the diff tab. Selection highlights + scrolls into view.
- **`CommitGraph.tsx`** — per-row SVG cell. Lane assignment computed incrementally in a memoized pass over loaded rows:
  - Maintain an ordered array of active lanes, each expecting a SHA.
  - For each commit: it occupies the leftmost lane expecting its SHA (or a new rightmost lane if none); other lanes expecting the same SHA emit merge edges and close; its lane's expectation becomes parent #1; parents #2+ open new lanes (emitting fork edges).
  - Output per row: `{ laneIndex, edges: [{from, to, kind}] }`; color = lane index mod palette. Appending older pages continues lane state — this is why contiguous pagination gives a consistent graph.
- **`CommitDetail.tsx`** — mode tab bar + selected commit content:
  - **Commit mode** — metadata header (author/date, refs, SHA with copy, clickable parent links that `selectCommit(parent)`), full message, then file list where each file expands into its diff (reuses `components/diff/DiffFile.tsx` per file, collapsed by default).
  - **Changes mode** — the existing diff layout (diff `FileTree` sidebar + `DiffFile` list) fed by the commit's parsed diff. No comment components rendered; `FileTree`'s `commentCounts` prop simply omitted. If extraction is needed, factor the comment-free core of `DiffView.tsx` into a shared component rather than duplicating.
  - **Tree mode** — reuses `components/file/FileTree.tsx` + `FileContent.tsx` against the `git/tree` + `git/file` endpoints; `?file=` search param as in the file tab.

### Hooks — `src/frontend/hooks/`

- `use-git-log.ts` — `useInfiniteQuery`, page param = row count so far; `fetchUntil(sha)` helper that requests with `until=` and appends; handles `409 stale` by resetting.
- `use-git-refs.ts` — refs query.
- `use-git-commit.ts` — commit meta + diff → `parseDiff` → token upgrade via `diff-tokens` with `sha` (mirrors `use-session-diff.ts` structure).

### Selection flow

`selectCommit(sha)`: if the SHA is in loaded rows → update `?commit=` and scroll to it. If not → `fetchUntil(sha)` (single request), then scroll. `?commit=` is the single source of truth; the detail pane fetches whenever it changes.

## Refresh / staleness

- Refs query refetches on window focus and when the session's activity signal settles (existing 300ms-debounced activity events over the WebSocket).
- If the refs payload `hash` changed → invalidate the log (reset to page 1) and refetch. Selected commit is kept if it still exists; otherwise selection falls back to HEAD.
- Commit detail is immutable per SHA → `staleTime: Infinity` (never refetch while cached), like diff tokens today. Memory stays bounded by React Query's default `gcTime` (5 min): only the selected commit's query is mounted, so previously viewed commits go inactive on selection change and are GC'd 5 minutes later. Re-selecting an evicted commit refetches — always correct for immutable data. Do not set `gcTime: Infinity`.

## Phasing

1. **Skeleton + commit inspection (useful on its own):** tab/route wiring; `git/log` (flat list, no graph, simple load-more), `git/refs`, `git/commit` endpoints; CommitList without graph column; Commit mode with expanding `DiffFile`s.
2. **Graph + navigation:** lane assignment + SVG cells; ref badges on rows; RefSidebar with filter; fetch-until-SHA; virtualization; drift detection.
3. **Remaining modes + polish:** Changes mode (comment-free diff layout); Tree mode (`git/tree` + `git/file`); `diff-tokens` `sha` support; refresh-on-activity; split-ratio persistence; Local Changes row.

## Out of scope (deliberately)

Mutations of any kind, stashes, submodules, reflog, blame, commit-message search, comparing two arbitrary commits, and commenting in the git view (review comments stay in the diff tab).
