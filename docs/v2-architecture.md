# CodeToaster v2 Architecture

Status: design draft. Target: a `v2` branch, merged once (big-bang), per the delivery
decision below.

## 1. What changes, in one paragraph

v1 treats a session as a **pet**: you create it, name it, keep it in a sidebar, and it
dies when you close it or when the daemon restarts. v2 treats it as **cattle**: you
type a prompt, pick a project, and a *task* is born. Tasks are durable records backed
by SQLite; the PTY running Claude Code is a disposable resource attached to a task and
harvested when idle. Reopening a task resumes the agent conversation
(`claude --resume <session-id>`) rather than reconstructing a process that never died.
The main pane becomes a VSCode-style tab area: the agent terminal is tab one
(unclosable), and diffs, files, commits, and extra shells open as sibling tabs that can
be reordered and split. The trees that today occupy full tabs (diff file tree, file
browser, commit list) move to a collapsible right sidebar whose selections open tabs.

## 2. Decisions taken

| Decision | Choice |
|---|---|
| Harvest triggers | Idle timeout, manual, and daemon restart. No LRU cap. |
| v1 pet sessions | Dropped. Every task is an agent task; plain shells exist only as extra terminal tabs *inside* a task. |
| Per-task git worktrees | In scope for v2. |
| Delivery | `v2` branch, big bang. |

The "browser close" trigger from the Detour build has no exact analogue here — the
daemon outlives the browser. Its equivalent is **all clients detached + agent idle**,
which is the idle trigger's precondition anyway (§6).

## 3. Vocabulary

| Term | Meaning |
|---|---|
| **Project** | A named directory + defaults (base ref, model, permission mode). Persisted today; gains fields. |
| **Task** | A durable unit of work: one Claude Code conversation, one working directory (possibly a worktree), one tab layout. The v2 replacement for "session". |
| **Agent PTY** | The PTY running `claude` for a task. Exactly one per live task. Disposable. |
| **Shell PTY** | An extra plain shell opened as a tab inside a task. Disposable, not resumable, dies with the task's PTYs. |
| **View** | One client-side terminal pane bound to a PTY. Two split panes showing the same PTY are two views. |
| **Tab / Tab group** | Frontend-only. A tab is a descriptor (agent, shell, diff, file, commit); a group is a column of tabs after a split. |

The critical structural change: **Task : PTY is 1 : N and the PTY side is disposable.**
In v1, `Session` *is* the PTY — identity, naming, cwd resolution, and process lifetime
are the same object. v2 splits them.

## 4. Agent control plane

This is the part that makes cattle possible, and it is all verified against
Claude Code 2.1.247 (see §4.4 for what is still assumed).

### 4.1 Starting a task

```
claude --session-id <uuid>          # we choose the conversation id up front
       --settings <per-task.json>   # injects our hooks without touching user config
       [--model <m>] [--permission-mode <p>]
       "<initial prompt>"           # positional: starts interactive, prompt submitted
```

The prompt goes through `argv`, not written into the PTY after startup — `Bun.spawn`
takes an array, so newlines and quotes need no escaping and there is no race against
the agent's startup paint.

**Scrub the inherited Claude Code env vars before spawning** — cheap insurance, not a
normal-path requirement. A daemon started the usual way (the user's shell, launchd,
systemd) has no `CLAUDE_CODE_*` in its environment and the scrub does nothing. But a
daemon started *from inside* an agent session inherits `CLAUDECODE`,
`CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_MESSAGING_*`,
`CLAUDE_PID`, `CLAUDE_EFFORT`, and `Pty` passes `{...process.env}` straight to the
child. The child then boots with transcript saving disabled ("⚠ Transcript saving is
off — inherited CLAUDE_CODE_CHILD_SESSION marker") — no transcript on disk, and
therefore nothing to resume.

This is mostly a development hazard — it is how it was found, and `bun run dev` from an
agent session hits it every time. The narrow runtime case is a *first* start from
inside an agent session: someone already in Claude Code who starts the daemon from
there, with no daemon running to conflict with. A restart from inside a task is not a
case, because it cannot happen — the restarting agent's own PTY dies with the daemon
partway through, taking the restart command with it (verified below).

The daemon is long-lived, so one poisoned start quietly degrades every task it spawns
afterwards, with a symptom (resume fails) that surfaces nowhere near the cause.
Filtering a handful of env keys costs less than the debugging session it prevents.

Because we pass `--session-id`, we know the conversation id *before* the process
starts. This is the answer to "how would we know the session ID to resume?" — we
assign it.

### 4.2 Staying in sync via hooks

`--settings` accepts a file path or a JSON string. We write
`~/.codetoaster/tasks/<task-id>/settings.json` containing hook definitions that all
point at one command: `codetoaster hook` (a new CLI subcommand). The task id and daemon
port travel in the PTY environment (`CODETOASTER_TASK_ID`, `CODETOASTER_PORT`), so the
hook command line is identical for every task.

Verified payloads (captured live):

```jsonc
// SessionStart
{"session_id":"1fc1…","transcript_path":"~/.claude/projects/<esc-cwd>/<sid>.jsonl",
 "cwd":"…","hook_event_name":"SessionStart","source":"startup"}
// Stop
{"session_id":"1fc1…","hook_event_name":"Stop","last_assistant_message":"pong",
 "permission_mode":"auto","effort":{"level":"high"},…}
// SessionEnd
{"session_id":"1fc1…","hook_event_name":"SessionEnd","reason":"other"}
```

Mapping to task state:

| Hook | Effect on the task record |
|---|---|
| `SessionStart` | `agent_session_id = session_id`, `transcript_path = …`, state → `live` |
| `UserPromptSubmit` | state → `busy` |
| `Stop` | state → `idle`, store `last_assistant_message` as the card preview, stamp `idle_since` |
| `Notification` | state → `needs_attention` (permission prompt / idle nag) |
| `SessionEnd` | state → `exited` with reason |
| `PreCompact` | state → `compacting` (cosmetic); its `trigger` is held for the SessionStart below |
| `SessionStart` (`source: compact`) | end of a compaction: `auto` → back to `busy` (mid-turn, `Stop` still to come), `manual` → `idle` (typed at the prompt, nothing else follows) |

Two things fall out of this that v1 cannot do:

1. **`/clear` is handled.** `/clear` starts a *new* conversation id inside the same
   process, which would silently strand a stored id. But `SessionStart` fires again
   with the new `session_id`, and we simply overwrite the field. The task's identity is
   ours; the conversation id underneath it is free to change.
2. **The task list becomes genuinely informative.** `busy` / `idle` / `needs_attention`
   is a precise signal, not the 300 ms output-activity debounce v1 infers from PTY
   bytes. With thirty cattle tasks, knowing which three want you is the whole product.

Constraints on the reporter, which must be treated as hard requirements:

- **It must print nothing to stdout.** `SessionStart` hook stdout is injected into the
  session as context. A chatty reporter would poison every conversation.
- **It must always exit 0 and fast.** Hooks run synchronously in the agent's path. Use a
  short fetch timeout (~1 s) and swallow every error. A daemon that is down must never
  wedge an agent.

### 4.3 Resuming

`claude --resume <agent_session_id>` in the task's cwd. Resume keeps the same
conversation id (verified), so the task row needs no update on a normal resume.

**A used session id cannot be reused.** `claude --session-id <uuid>` on an id that
already has a transcript fails with `Session ID <uuid> is already in use.` So the
"start fresh" fallback below must allocate a *new* uuid and write it to the task row —
restarting with the stored id fails a second time and would strand the task in a
retry loop.

If the stored id is unusable (transcript pruned, version skew), fall back in order:

1. `claude --continue` — "most recent conversation in this directory". With
   worktree-per-task, one directory holds exactly one conversation, so this is
   unambiguous. Worktrees buy correctness here, not just isolation.
2. Scan `~/.claude/projects/<escaped-cwd>/*.jsonl` for the newest transcript whose
   `sessionId` we have seen, or whose mtime falls inside the task's lifetime.
3. Surface a "could not resume — start fresh in this directory?" state on the task card.
   A task that cannot resume must degrade to something the user can act on, never to a
   broken terminal.

### 4.4 Verified (Phase 0 spike, Claude Code 2.1.247)

All of these were open assumptions when this doc was drafted; each was checked against
a live agent, twice where the first result was misleading.

| Question | Answer |
|---|---|
| Does `--settings` merge with the user's own hooks, or shadow them? | **Merges.** A project-level `SessionStart` hook and an injected one both fired on the same start. A user's hooks survive. |
| Does `/clear` report itself? | **Yes.** `SessionEnd` on the old id, then `SessionStart` with `source: "clear"` and a **new** `session_id`, and a new transcript file. The §4.2 story holds. |
| Does resume report itself? | **Yes** — `SessionStart` with `source: "resume"`, same `session_id`. |
| Can a used `--session-id` be reused? | **No** — `Session ID <uuid> is already in use.` See §4.3. |
| Does a PTY-spawned agent behave like a terminal one? | Yes — unless the daemon inherited Claude Code's env markers, which disables transcript saving in the child (§4.1). Only reachable when the daemon is launched from inside an agent session. |

The `/clear` test is the cautionary one: the first run showed *no* `SessionStart`, which
read as "`/clear` is invisible to us" and would have sent the design chasing transcript
scanning. The real cause was the inherited env marker — the agent was running degraded.
Worth remembering when a future spike produces a tidy negative result: check that the
subject is healthy before believing it.

## 5. Server architecture

### 5.1 Task store (SQLite)

`lib/db.ts` already has an append-only migration harness; v2 adds migrations, not a new
database.

```sql
CREATE TABLE tasks (
  id                    TEXT PRIMARY KEY,     -- our id; the slug is derived from it
  project_id            TEXT NOT NULL REFERENCES projects(id),
  title                 TEXT NOT NULL,        -- from the first prompt; renameable
  title_source          TEXT NOT NULL,        -- 'derived' | 'manual'
  initial_prompt        TEXT NOT NULL,
  repo_root             TEXT NOT NULL,        -- resolved once, not re-derived from a PTY
  cwd                   TEXT NOT NULL,        -- == worktree_path when one exists
  worktree_path         TEXT,                 -- NULL when running in the project dir
  branch                TEXT,
  base_ref              TEXT,
  worktree_state        TEXT NOT NULL,        -- none|present|evicted|missing (§5.6)
  wip_ref               TEXT,                 -- refs/codetoaster/wip/<id> while a snapshot exists
  wip_at                INTEGER,
  setup_duration_ms     INTEGER,              -- last setup_command run; scales eviction grace
  pinned                INTEGER NOT NULL DEFAULT 0,  -- exempt from eviction
  agent_session_id      TEXT,                 -- the uuid we passed to --session-id
  transcript_path       TEXT,
  agent_state           TEXT NOT NULL,        -- starting|busy|idle|needs_attention|exited|unknown
  lifecycle             TEXT NOT NULL,        -- live|suspended|archived
  last_message          TEXT,                 -- Stop hook preview text
  last_size_cols        INTEGER, last_size_rows INTEGER,
  model                 TEXT, permission_mode TEXT,
  created_at            INTEGER NOT NULL,
  last_active_at        INTEGER NOT NULL,
  idle_since            INTEGER,
  exit_code             INTEGER
);
CREATE INDEX tasks_by_recency ON tasks(last_active_at DESC);
```

Scrollback snapshots are **not** stored in SQLite — they are multi-hundred-KB ANSI
blobs. They live at `~/.codetoaster/tasks/<id>/scrollback.ans`, alongside that task's
`settings.json`.

`projects` gains `default_base_ref`, `default_model`, `default_permission_mode`,
`worktree_default`, `setup_command` (run after every `git worktree add`, e.g.
`bun install`), and `worktree_copy` (ignored files to copy from the project checkout,
e.g. `.env`).

### 5.2 `TaskManager` replaces `SessionManager`

Responsibilities split three ways where v1 had one class:

- **`TaskStore`** — pure CRUD over the tables above. No processes.
- **`PtyManager`** — owns live `Pty` objects (the renamed, slimmed `Session`): spawn,
  write, resize, serialize, kill. Knows nothing about tasks, worktrees, or naming.
- **`TaskManager`** — the policy layer: create/resume/harvest/archive, hook ingestion,
  broadcast. The only place that knows a task can exist without a process.

`Session` (399 lines) survives as `Pty` largely intact — the OSC 9/777/99 handlers,
serialize-on-attach, activity debounce, `getCwd()`/`getForegroundPid()`, and
`sanitizeSize()` all carry over. What leaves it: `name`/`nameSource` (a task property
now) and the assumption that the command is `$SHELL` — the constructor takes
`command: string[]` so it can spawn either `claude …` or a plain shell.

### 5.3 Multiplexed WebSocket (protocol v2)

This is the highest-risk server change. Today `clientToSession: Map<clientId, sessionId>`
is 1:1, every terminal message is implicitly addressed to "the client's one session",
and the frontend holds a single `TerminalHandle` in a context ref. Tabs and splits break
all three.

Because terminal tabs are not splittable (§7.2) — a terminal can be *moved* between
groups but never shown twice at once — **a client has at most one view per PTY**. That
makes `ptyId` a sufficient address on its own: no separate view id, and the connection
key is simply `${clientId}:${ptyId}`.

```ts
// client -> server
| { type: "open";   ptyId: string; cols?: number; rows?: number }
| { type: "close";  ptyId: string }
| { type: "input";  ptyId: string; data: string }
| { type: "resize"; ptyId: string; cols: number | null; rows: number | null }

// server -> client
| { type: "restore"; ptyId: string; data: string; size; cursor; cursorHidden; mouseEncoding }
| { type: "stream";  ptyId: string; data: string }
| { type: "resize";  ptyId: string; cols: number; rows: number }
| { type: "exit";    ptyId: string; code: number }
| { type: "tasks";   list: TaskInfo[]; projects: ProjectInfo[] }   // snapshot
| { type: "task";    task: TaskInfo }                              // delta
| { type: "activity" | "notification"; taskId: string; … }
```

Multi-client is untouched: two browsers on the same PTY are still two connections with
independent `restore` and shared `stream`, which is what v1 already does — only the
*within one client* fan-out disappears. If terminal splitting is ever allowed, this is
the one place that has to change: reintroduce a client-generated `viewId`, key on
`${clientId}:${viewId}`, and let `stream` fan out client-side.

That constraint is worth keeping for a reason beyond simplicity: duplicating one PTY
into two panes of the same window puts smallest-wins negotiation in an unwinnable
position, where dragging a split narrow reflows the agent's output in the pane you were
reading. Splitting is for putting *different* things side by side; a second terminal is
a second PTY.

Internally `Pty.clients` re-keys from `clientId` to `${clientId}:${ptyId}`. Everything
else about smallest-wins negotiation is unchanged, and two existing rules become load-
bearing rather than incidental:

- **`size: null` means "not measured, does not constrain".** v1 added this for clients
  that load on the diff tab. v2 leans on it hard: a terminal in a *hidden tab* reports
  null, stays attached, and keeps receiving output without shrinking everyone else's
  grid to its stale layout.
- **Zero attached views keeps the last size** (`recalculateSize` early-returns). For
  cattle this is essential — an agent working with nobody watching must not have its
  grid collapse. `last_size_cols/rows` persists this across a harvest so a resumed task
  respawns at the size it had.

**Status: implemented and proven (Phase 0).** `SessionManager` now holds
`clientSessions: Map<clientId, Set<sessionId>>`, attaching no longer detaches what the
client already had, and `getClientSession(clientId, sessionId)` treats attachment as
authorization — naming a session you never attached to gets you an error, not a writable
PTY. `updateClientSize` gained the null case that hidden tabs need. Covered by
`src/lib/xtmux/multiplex.test.ts` (12 tests over the §9 rules) and verified end-to-end:
one socket, two live shells, output correctly routed by session with no cross-talk.

One deliberate deferral: the wire still says `sessionId`, not `ptyId`. A v1 session *is*
a PTY, so the rename belongs with the `Pty` extraction in Phase 1 — doing it here would
have mixed a mechanical rename across every frontend file into the change that actually
carries the risk.

**Task CRUD moves off the WebSocket to HTTP.** Creating a task can create a worktree,
run git, and fail in interesting ways; that wants status codes and a response body, not
a fire-and-forget socket message with an `error` string. `POST /api/tasks`,
`PATCH /api/tasks/:id`, `POST /api/tasks/:id/resume`, `POST /api/tasks/:id/archive`.
The socket keeps PTY traffic plus the push channel.

### 5.4 API routes stop depending on a live process

Today every data route funnels through `resolveSessionGitRoot(sessionId)`, which calls
`session.getCwd()` — `lsof`/`readlink` against a *running* PTY. A harvested task has no
process, so under v2 that helper would 404 the diff, file, git, symbol, and highlight
routes for every suspended task. Since the whole point is browsing a task you are not
currently running, this must change:

```ts
resolveTaskRoot(taskId) -> { repoRoot, cwd }   // read from the task row
```

`repo_root` is computed once at task creation and stored. Live `getCwd()` is kept for
one narrow purpose it is actually good at: noticing that the agent has `cd`'d somewhere
unexpected, which can update the row opportunistically.

Mechanical consequences: `/api/sessions/:id/*` → `/api/tasks/:id/*` across
`api/{diff,files,git,highlight,symbols}.ts`, and the matching frontend hooks. The route
*bodies* are untouched — they already take a directory and do their own git work.

### 5.5 Harvester

A single interval (~30 s) over live tasks. Harvest when **all** hold:

- `lifecycle === 'live'`
- `agent_state === 'idle'` (the `Stop` hook fired; never on `busy` or `needs_attention`)
- zero attached views across all clients
- `now - idle_since > harvest_after` (default 30 min, configurable, `0` = never)
- no shell PTY in the task has a foreground process other than the shell itself
  (`getForegroundPid()` already exists for this)

Harvesting: serialize the agent terminal to `scrollback.ans`, persist `last_size`, kill
every PTY of the task, `lifecycle = 'suspended'`, broadcast.

Manual harvest is the same path minus the guards (with a confirm when `busy`). Daemon
restart needs no work beyond honesty: on boot, every `live` row becomes `suspended`,
since its PTY died with the parent. **Verified** — when the daemon exits without
killing its sessions (what `/api/shutdown` does today), closing the PTY masters takes
down both the session shells and their background children, so there are no orphaned
agents to reap and no risk of a resumed task colliding with a still-running one. That single line converts today's "restart nukes
everything" into "restart suspends everything, resume on click" — and makes `bun --hot`
development far less hostile.

**Reopening a suspended task is two-phase**, because a resumed agent repaints a fresh
screen that will not match the snapshot:

1. Immediately send the stored `scrollback.ans` as a `restore`, rendered read-only with
   a "suspended — resuming…" affordance. The user sees where they left off instantly.
2. Spawn `claude --resume`; on its first paint, reset and swap to the live PTY.

Shell tabs are not resumable, and the choice this left open is made: **they are
dropped from the layout, and the user is told.** Respawning them empty was the
alternative and it is worse — it puts N processes back that nobody asked for,
and an empty shell at the task cwd carries no memory of what the tab was for, so
it preserves the shape of the workspace while losing everything that made it
one.

The rule the client applies is *drop on positive knowledge, never on absence*
(`reconcileShellTabs`), and there are exactly three things that count:

- the task is not `live` — suspension is precisely "this task holds no
  processes", so every shell tab in a restored layout is stale. This is what
  survives a page reload across a harvest, where the client was never around to
  see the shells alive.
- the task is live and a PTY it *had* reported is no longer in `shellPtyIds` —
  something killed it: this tab closed in another browser, or the route called
  directly. A shell that merely *exits* keeps its tab, showing its exit code
  the way an agent whose process died does; `PtyManager` only forgets a PTY
  when something kills it, so the task goes on reporting that one and closing
  the tab is what reaps it.
- the tab was *restored from disk* and the live task does not report its PTY.
  Nothing is in flight for a tab this client did not spawn, so absence is
  evidence rather than silence — which is the only thing that catches a shell
  killed while nobody was watching and the task then brought back to `live`
  (a daemon restart, or a harvest the user resumed from the sidebar). Without
  it that tab meets neither rule above and stays forever, attached to nothing.
  `TaskShell` seeds the ids of a freshly loaded layout's shell tabs into `seen`
  for exactly this.

The distinction matters because a shell tab is opened from the response to
`POST /api/tasks/:id/shell`, which races the task deltas on the socket: one
computed a moment before the spawn carries a `shellPtyIds` without it. Pruning
on absence would let that delta close the tab the user just opened.

### 5.6 Worktrees

Worktrees are what let cattle be parallel at all — without them, N tasks in one project
fight over one checkout's index and HEAD. But a worktree is stateful and a task is never
explicitly closed (§6), so left alone they accumulate without bound. The resolution is
the same one the PTY got: **the worktree is a materialized cache of the branch.** The
branch — plus a WIP snapshot ref when the tree is dirty — is the durable artifact;
the checkout is disposable and rebuildable. Nothing the user cares about lives in a
process or a directory; it lives in SQLite and in git.

New `lib/worktree/*`:

**Create.** `git worktree add <path> -b <branch> <base_ref>` at
`~/.codetoaster/worktrees/<project-id>/<task-id>` — outside the repo, so no
`.gitignore` interaction. The path is derived from **ids, not slugs**: Claude Code keys
transcripts on the escaped cwd, so a path that moved when a task was renamed would take
the `--resume` lookup and the `--continue` fallback down with it. The same rule makes
evict/restore land on the same path. Branch naming: `codetoaster/<task-slug>` with
collision suffixing. All git that touches a repo's worktree list is serialized per
`repo_root` — `git worktree add` takes repo locks, and N parallel creations race on the
collision suffix. After creation (and after every restore) run the project's
`setup_command` and copy `worktree_copy` files; the output renders in the agent tab
rather than blocking silently, by spawning the agent as
`sh -c '<setup> && exec "$@"' sh claude …` so the prompt still travels through argv.

**Three levels of gone**, each strictly downstream of the last:

| Level | Removes | Keeps | Reversible | Trigger |
|---|---|---|---|---|
| suspend (§5.5) | PTYs | worktree, row, scrollback | yes | idle / manual / restart |
| **evict** | the checkout directory | branch, WIP ref, row, scrollback | yes | suspended + grace elapsed, or manual |
| archive | worktree; branch only if merged or pushed | WIP ref for N days | mostly | explicit, confirmed |

Eviction only has to answer "is this recoverable?" — a suspended task has no PTYs, so
the harvester's is-anything-running guards are already discharged.

**Dirty trees are evictable.** In-progress cattle are dirty most of the time, so a
"never evict dirty" rule would leave the sprawl problem unsolved for exactly the tasks
that accumulate. Instead, snapshot the whole working state into a commit under our own
ref namespace, built through a throwaway index so the live tree is never mutated:

```sh
GIT_INDEX_FILE=$tmp git read-tree HEAD
GIT_INDEX_FILE=$tmp git add -A
TREE=$(GIT_INDEX_FILE=$tmp git write-tree)
WIP=$(git commit-tree $TREE -p HEAD -m "codetoaster wip <task-id>")
git update-ref refs/codetoaster/wip/<task-id> $WIP
git worktree remove --force <path> && git worktree prune
```

The ref keeps the objects alive against gc and, living under `refs/codetoaster/*`
rather than `refs/stash`, never entangles with the user's stash stack. The branch is
untouched — no synthetic commit in their history, no untracked file promoted to
tracked. Known simplifications: one tree flattens staged-vs-unstaged, and `git add -A`
honours `.gitignore`, so ignored build artifacts do not survive — which is why
`setup_command` / `worktree_copy` are load-bearing, not optional. Verified on a scratch
repo: a modified tracked file restores as modified, an untracked file as untracked,
HEAD and branch history intact.

**Restore** is the mirror of agent resume and hides behind the same two-phase banner
(§5.5, "restoring workspace…"):

```sh
git worktree add <path> <branch>
git read-tree -u --reset refs/codetoaster/wip/<task-id>
git reset --mixed HEAD        # files stay, index returns to HEAD: dirt reads back as dirt
```

then `setup_command`, then `claude --resume`. **Guard: the branch may have moved.** If
the user committed to the branch from another checkout between evict and restore, the
snapshot's parent is a stale HEAD and `read-tree --reset` would overwrite the newer
commit's changes with old dirt. Restore checks `wip.parent == branch HEAD`; on mismatch
it restores the clean worktree and offers *apply stale WIP / keep as ref / discard* on
the task card — broken-but-actionable, never silent.

**Eviction policy** is driven by restore *cost*, not age or disk: grace =
base (default 7 days) scaled by the last `setup_duration_ms`, so a task whose restore
re-runs a 90-second install waits far longer than one that restores in 200 ms.
`pinned` exempts a task outright. A per-project eviction is also available manually.

**Archive always snapshots before destroying** — the WIP ref is written
unconditionally and kept for N days (default 30), so the confirmation dialog offers a
recoverable action rather than a bet. Branch deletion uses `git branch -d` semantics:
only when merged into the base ref or pushed, and the default leans toward keeping,
since a ref costs nothing next to losing commits. The remote is never touched. A
separate hard *delete* drops the refs; that is the only truly irreversible operation.

**The card tells the truth.** Each task shows `worktree_state`, dirty file count,
unpushed commit count, and merged-into-base — cheap (`git status --porcelain`,
`git rev-list @{u}..`, `git branch --merged`), computed lazily on render or cached per
harvester tick. A merged task is done; that is the natural set to suggest archiving.

**Boot reconciliation runs both ways**, per project, from `git worktree list
--porcelain` against task rows:

- directory on disk, no row → remove if clean; if dirty, leave it and surface an
  *unclaimed worktree* card with a manual delete. Never auto-delete dirty, even orphans.
- row says `present`, directory gone (user `rm -rf`, disk cleaner, moved repo) →
  `worktree_state = missing`; restore on open. Branch also gone → a
  broken-but-actionable card, never a dead terminal.
- `git worktree prune` afterwards; expire WIP refs past their retention.

## 6. Task lifecycle

```
                    POST /api/tasks
                          │
                          ▼
                     ┌─────────┐   SessionStart    ┌──────┐
                     │ starting│──────────────────►│ live │
                     └─────────┘                   └──┬───┘
                                                      │
                     UserPromptSubmit ────► busy ─────┤
                     Stop ─────────────────► idle ────┤
                     Notification ──► needs_attention ┤
                                                      │
                    idle + no views + timeout         │  manual "close"
                    or daemon restart                 │  (chat has no explicit close;
                          ▼                           │   this is the escape hatch)
                    ┌───────────┐                     │
                    │ suspended │◄────────────────────┘
                    └─────┬─────┘
                          │ open / POST resume  → claude --resume
                          ▼
                       (live)

    archive (explicit, destructive): row kept or deleted, worktree removed,
    scrollback deleted. The only way a task truly leaves.
```

Chat products have no "close", and neither should this: closing a task suspends it.
Archive is the deliberate, confirmed, worktree-cleaning operation. Eviction (§5.6) is
not a lifecycle state of its own — it is `worktree_state` on a suspended task, and
opening the task restores the checkout before resuming the agent.

## 7. Frontend architecture

### 7.1 Shell layout

```
┌────────────┬───────────────────────────────────────────┬──────────────┐
│ Task list  │  tab bar (drag to reorder, split)         │  Explorer    │
│ (left,     │ ┌────────┬─────────┬─────────┬──────────┐ │  (right,     │
│ collapsible│ │ Agent  │ diff:…  │ file:…  │ shell    │ │ collapsible) │
│  , grouped │ ├────────┴─────────┴─────────┴──────────┤ │              │
│  by project│ │                                       │ │  Changes     │
│  , state   │ │         active tab content            │ │  Files       │
│  dots)     │ │         (splittable into groups)      │ │  History     │
│            │ │                                       │ │  Refs        │
│ + New task │ └───────────────────────────────────────┘ │              │
└────────────┴───────────────────────────────────────────┴──────────────┘
```

The trees move right; the content moves into tabs. The agent terminal is tab one and
cannot be closed — closing it would mean "kill the task", which is what the task list's
close action is for.

This layout is built, as `frontend/components/v2/AppShell.tsx`, together with the v2
design system it is drawn from — the token layer in `frontend/index.css` and the shell
components beside it (see CLAUDE.md, "The v2 design system is the new UI"). It is layout
only: the lists, tabs and status values below all arrive as props, so the tasks in this
section supply data rather than restructure markup. `routes/shell.tsx` renders it with
fixture data until TASK-28 puts it at `/`.

One departure from the sketch above. The Explorer's four sections are reached from a
rail on the window's right edge rather than a row of tabs inside the panel, and that
rail is also the panel's toggle: clicking a section switches to it, clicking the section
already showing hides the panel. A separate collapse button sat next to Split and read
as the same control, and a rail names the section a click will open and keeps a
section's count legible with the panel shut.

### 7.2 Tab model

```ts
type TabDescriptor =
  | { kind: "agent" }                                   // unclosable, exactly one
  | { kind: "shell";  ptyId: string }
  | { kind: "diff";   path: string }                    // working-tree diff, one file
  | { kind: "diffAll" }                                 // the current all-files DiffLayout
  | { kind: "file";   path: string; line?: number }
  | { kind: "commit"; sha: string }
  | { kind: "history" };                                // graph, when opened as a tab

const tabKey = (d: TabDescriptor) => …;                 // stable string; dedupe + focus
```

`tabKey` is the whole dedupe story: clicking a file that is already open focuses its tab
instead of opening a second one.

**Terminal tabs (`agent` and `shell`) are not splittable.** They can be dragged into
another group, so a terminal-left / diff-right layout works, but the Split command is
disabled on them and they never appear in two groups at once. Read-only tabs (`diff`,
`file`, `commit`, `history`) split freely — showing one file beside another is the
point. When a user wants a second terminal, they open one: that's a new shell PTY, not
a second view of an existing one. §5.3 covers what this buys on the wire. Adopt VSCode's **preview tab** as well — a single click
opens an italic tab that the next single click replaces, double-click pins it. Without
it, clicking through thirty commits leaves thirty tabs, which is exactly the failure
mode that makes tab UIs annoying.

Layout is a flat row of groups, not a recursive grid:

```ts
interface TabGroup { id: string; tabs: TabState[]; activeTabId: string; flex: number }
interface TaskLayout { groups: TabGroup[]; activeGroupId: string }
```

One-dimensional splits cover the real use (terminal left, diff right) for a fraction of
the code of a recursive tree. Nested splits are a later change to this type alone.

**Persistence:** per-task layout in `localStorage`, keyed by task id. Layout is a
per-device concern — a phone should not inherit a desktop's three-way split — and
persisting it fixes a v1 annoyance where a page reload loses all view state. The shape
is serializable, so moving it server-side later (for cross-device continuity) is a
migration, not a redesign.

### 7.3 Routing

Route surface shrinks from five routes to three:

- `/` — the app shell with the composer in the main pane (no task selected)
- `/t/$slug` — a task; open tabs and the active tab come from the stored layout
- `/t/$slug?tab=<tabKey>` — deep link: ensure that tab exists, focus it

Today's `sessions.$slug.{diff,file,git}.tsx` routes and the `TAB_ROUTES` /
`tabNavTarget` / `sessionNavTarget` machinery in `utils/session-nav.ts` disappear —
their whole job was making a four-way tab switcher survive in the URL, which the layout
store now owns. `slug.ts` survives with `task` naming (`{slugified-title}-{uuid}`, id
still the last 36 chars).

### 7.4 State

Three stores, replacing one context that does everything:

- **`TaskContext`** — task list, projects, per-task agent state, notifications. Fed by
  the socket's `tasks`/`task`/`activity`/`notification` messages, mutated via HTTP.
- **`PtyContext`** — the socket multiplexer: `attach(ptyId, handlers)`,
  `sendInput(ptyId, data)`, `resize(ptyId, size)`, plus the message router that
  dispatches `stream`/`exit`/`restore` to the one terminal bound to that ptyId. This is
  what replaces the single `terminalRef` and its message queue.
- **`view-state-store`** — survives, but **re-keyed from session id to tab key**. Its
  content (scroll offsets, expanded/collapsed path sets, hunk expansions, comments) and
  every helper (`pruneSet`, `toggleInSet`, `withAll`, `pruneComments`, …) carries over
  unchanged; only the top-level keying and the `GitViewState`/`DiffViewState` shapes
  change, since a per-file diff tab needs far less state than today's whole-view blob.

`Terminal.tsx` becomes multi-instance: it takes a `ptyId` and calls `PtyContext` itself
rather than being a singleton addressed through a ref on the session context. Its
internals — fit-only-when-visible, theme, touch scrolling, search addon, drag/drop,
RIS-through-the-write-buffer on restore — are the hard-won parts and stay as they are.

### 7.5 Composer and the task list

The composer is a *pane*, not a page. The app shell — left task list, right Explorer —
stays mounted; `/` simply renders the composer where the tab area would otherwise be.
Starting a new task and resuming an old one are then the same gesture in the same place:
type above, or click a task in the sidebar.

The composer itself:

- prompt textarea (⌘⏎ to submit)
- project selector (existing `projects`, with `initialPath`)
- an options row: new-worktree toggle + base ref, model, permission mode

**The left sidebar is the chat history, and the primary resume affordance.** v1's
sidebar already does this job; what changes is what it has to survive. A cattle list
grows without bound and is no longer hand-curated, so it needs:

- recency ordering across projects (with project grouping as a toggle, not the only
  view — v1's project-first grouping assumes a list you maintain by hand)
- a filter box, since scanning stops working somewhere around thirty tasks
- state dots — `busy` / `idle` / `needs_attention` from §4.2 — and the `last_message`
  preview from the `Stop` hook, so the list answers "which of these want me?" at a glance
- **suspended tasks shown as ordinary, clickable rows.** A harvested task is the normal
  resting state of a finished conversation, not an error or a tombstone. If suspension
  reads as failure in the UI, the whole cattle model feels lossy.
- archived tasks hidden behind a toggle

Because the sidebar carries history, the composer stays minimal — no "recent tasks"
list underneath duplicating what is already on screen.

Submit → `POST /api/tasks` → server creates the worktree, writes the per-task settings,
spawns the agent with the prompt in argv → client navigates to `/t/<slug>` with the
agent tab focused.

**The initial prompt becomes the title** — first line, whitespace collapsed, truncated
(`titleFromPrompt`). It is recorded as `derived`, not `manual`: it is a guess from an
opening line, so the live OSC terminal title is still projected over it by
`sessionDisplayNames` exactly as it is over a `<dir> · <branch>` label. A rename is the
only thing that outranks the agent's own account of what it is doing. A task started
with no prompt — the sidebar's New task button — falls back to `<dir> · <branch>`.

The card's second line is **`last_message`, not the terminal title.** The original plan
here was to demote the OSC projection to a subtitle, but the two want the same row and
`last_message` wins it: this list exists to answer "which of these want me?", and the
last thing the agent *said* answers that where a title saying `Editing manager.ts` does
not. The terminal title takes the line only when there is no `last_message` and it is
not already serving as the label — repeating the label underneath itself says nothing
(`previewOf`).

## 8. Reuse inventory

**Carries over essentially unchanged** — this is most of the codebase's value, and none
of it is coupled to the pet model:

`components/diff/*` (`DiffLayout`, `DiffFile`, `FileTree`, `ImageDiff`, `DiffStat`),
`components/file/*`, `components/git/*` (`CommitGraph`, `CommitList`, `CommitDetail`,
`RefSidebar`), `utils/{parseDiff,wordDiff,commitGraph,refTree,sortFiles,syntaxHighlight,
languageDetection,symbolHighlight}`, all of `lib/highlight/*` and `lib/symbols/*`, the
`api/*` route bodies, `api/utils.ts` (`gitSpawn`, `buildFileListing`, `safePath`),
`lib/db.ts`'s migration harness, `cli/*`, `Terminal.tsx`'s internals, and the tests
attached to all of it.

**Reworked:** `lib/xtmux/session.ts` → `Pty` (command param, view re-keying),
`session-manager.ts` → split three ways, `view-state-store.ts` (re-key to tab keys),
`naming.ts` (demoted to status-line projection), `api/utils.ts:resolveSessionGitRoot` →
`resolveTaskRoot`, `slug.ts` (task naming), and `AppSidebar.tsx` — it keeps its job as
the history/resume list (§7.5) but trades hand-curation for recency, filtering, and
agent-state dots. `hooks/use-sidebar-drag.ts` (331 lines of manual reordering) likely
goes with that: you don't hand-sort cattle.

**Rewritten:** `App.tsx`, `SessionContext.tsx`, `TopBar.tsx`,
`TabSwitcher.tsx`, `routes/*`, `DiffView.tsx` / `FileView.tsx` / `GitView.tsx` (become
thin tab hosts over the layouts they already delegate to), `CommandPalette.tsx`
(task-oriented, not session-oriented).

**New:** `lib/tasks/{store,manager,harvester}.ts`, `lib/worktree/*` (create/remove,
WIP snapshot/restore, evictor, reconciliation), `lib/agent/`
(spawn args, settings file generation, hook ingestion), `cli/hook.ts`,
`frontend/layout-store.ts`, `frontend/components/tabs/*`, `frontend/Composer.tsx`,
`frontend/components/Explorer.tsx`.

## 9. Risks

1. ~~**Multiplexed PTY protocol.**~~ **Retired in Phase 0.** The negotiation rules that
   would have shown up as another client's terminal resizing to 9×5 are now pinned by
   `multiplex.test.ts`: hidden-tab-reports-null, two-clients-one-pty,
   zero-attachments-keeps-size, detach-recalculates, one-client-attaches-many-ptys,
   plus input isolation between sessions. Re-check these whenever `Pty` is extracted.
2. **Resume fidelity.** `claude --resume` repaints from scratch; the snapshot and the
   resumed screen will not agree. The two-phase restore (§5.5) makes that honest instead
   of glitchy. Resume *failure* must land on an actionable card, never a dead terminal.
3. **Harvesting a busy agent.** Data loss if the guards are wrong. The guards are
   conservative by construction (idle hook + no views + timeout + no foreground
   process); when in doubt, do not harvest.
4. **Hook dependency.** A user running `--bare`, with hooks disabled, or a future
   Claude Code that changes payloads, leaves tasks in `unknown` state. Everything must
   still work degraded: fall back to the v1 output-activity heuristic for busy/idle, and
   to `--continue` for resume. Never let a missing hook make a task unusable.
5. **Worktree sprawl.** Disk and stale branches. The evict tier (§5.6) is the answer,
   and it only works if dirty trees are evictable — hence the out-of-branch WIP
   snapshot. Boot must reconcile both ways; the UI must show which tasks own
   worktrees and whether they are dirty, unpushed, or merged.
6. **Mobile regression.** v1 has real accumulated mobile work (touch scrolling in the
   alt buffer, pinch, keyboard viewport, sidebar sheets). Splits are meaningless on a
   phone: below the mobile breakpoint, force a single tab group and render both sidebars
   as sheets. Re-verify the touch fixes on the new shell explicitly.
7. **Branch drift.** Big-bang on a long-lived branch while v1 keeps taking fixes. Land
   the mechanical, low-conflict pieces first (the `sessions→tasks` route rename, the
   `Pty` extraction) and rebase on `main` frequently rather than at the end.

## 10. Phases

Each phase should end with the branch running, which keeps the big bang from becoming a
big bang *at merge time*.

- **Phase 0 — Spike. Done.** Both halves: the agent-integration findings in §4.4, and
  the multiplexed WebSocket in §5.3 — one client now holds many sessions at once, proven
  by unit tests and an end-to-end two-terminal socket run. The v1 UI was carried across
  the protocol change rather than left broken, so the branch still runs.
- **Phase 1 — Task model.** Migrations, `TaskStore`, `Pty` extraction, `TaskManager`,
  `resolveTaskRoot`, `/api/tasks/*` route rename. v1 UI can stay bolted on top to keep
  the branch runnable.
- **Phase 2 — Agent control plane.** Spawn with `--session-id`/`--settings`,
  `codetoaster hook`, hook ingestion → `agent_state`, resume path with its fallbacks.
- **Phase 3 — Harvester.** Idle/manual/restart, scrollback snapshots, two-phase restore.
- **Phase 4 — New shell.** Composer, task list, tab groups + splits, right-hand
  Explorer, layout store, re-keyed view state. The bulk of the frontend work.
- **Phase 5 — Worktrees.** Creation options in the composer, WIP snapshot/restore,
  the evict tier, archive cleanup, two-way boot reconciliation, worktree-aware task
  cards.
- **Phase 6 — Polish.** Mobile pass, keyboard shortcuts (tab nav, split, close),
  command palette over tasks and tabs, one-time migration of v1 projects, README.
