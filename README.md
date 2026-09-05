# CodeToaster

A browser-based workspace for running many Claude Code agents at once. You type
a prompt, pick a project, and a *task* is born: a durable record in SQLite with
its own conversation, its own working directory, and its own tab layout. The
process running the agent is disposable — it is harvested when idle and resumed
when you come back — so thirty tasks cost thirty rows, not thirty terminals.

## Screenshots

![Terminal](images/terminal.png)

![Diff Viewer](images/diff.png)

## How it works

### Tasks

A task is one Claude Code conversation, one working directory (optionally a git
worktree), and one tab layout. It is the unit everything else hangs off: the
diff you are reviewing, the files you are browsing, the commits you are reading
are all *that task's*, resolved from its stored repo root rather than from a
live process.

You start one from the composer, which renders where the tab area would
otherwise be, with both sidebars still mounted — starting a task and resuming
an old one are the same gesture in the same place. It asks for:

- the **prompt** (⌘⏎ / Ctrl+Enter to submit) — its first line becomes the task's
  title, until the agent's own terminal title says something better, or you
  rename it
- the **project** — a named directory with its own defaults
- the **model** — or the project's default
- **new worktree** and a **base ref** — see below

Each field sends nothing when it matches the project's own answer, so the HTTP
API and the CLI resolve defaults the same way the UI does.

### Live, suspended, archived

Chat products have no "close", and neither does this. A task moves between three
states:

- **live** — a PTY is running `claude`, and the agent reports `busy`, `idle`, or
  `needs_attention` back through hooks (see [Agent integration](#agent-integration)).
- **suspended** — no processes. A task suspends when it has been idle with
  nobody watching for `harvest_after`, when you close it, or when the daemon
  restarts (a restart suspends *everything*, rather than losing it). Its
  scrollback is snapshotted to disk first.
- **archived** — the deliberate, confirmed operation. The confirmation tells you
  what it will cost before you agree: the worktree is removed, a WIP snapshot is
  written unconditionally, and the branch is kept unless it is merged or pushed.

Suspended tasks are ordinary, clickable rows in the sidebar, not tombstones.
Opening one restores its checkout if it was evicted, replays the stored
scrollback read-only while it comes back, then runs `claude --resume` and swaps
to the live terminal on its first paint.

**Shell tabs do not survive a resume.** They are plain shells with nothing to
resume into, so they are dropped from the restored layout and the app tells you
how many it closed.

### Worktrees

A task can run in its own git checkout, which is what makes parallel tasks in
one repository possible at all.

- The checkout lives at `~/.codetoaster/worktrees/<project-id>/<task-id>` —
  outside the repository, so nothing has to be added to `.gitignore`. The path
  is built from ids, never slugs, because Claude Code files a transcript under
  its escaped cwd and a directory that moved on rename would take `--resume`
  down with it.
- The branch is `codetoaster/<title-slug>`, suffixed `-2`, `-3`… on collision.
- After every creation and every restore, the project's **setup command** runs
  (`bun install`, say) and its **worktree copy** list is copied across from the
  project checkout (`.env` and friends, which git would not carry). Both are
  project settings, and both are load-bearing rather than optional: the eviction
  snapshot below honours `.gitignore`, so ignored build artifacts do not survive
  one.
- A suspended task's checkout is **evicted** once its grace has elapsed: its
  working state is committed to `refs/codetoaster/wip/<task-id>` through a
  throwaway index — so the live tree is never mutated and your stash stack is
  never entangled — and the directory is removed. Opening the task rebuilds it
  and reads the snapshot back so dirt reads as dirt. If the branch moved
  underneath the snapshot, you are offered the choice rather than silently
  overwritten.
- On boot, worktrees on disk are reconciled against task rows both ways. A
  checkout with no task shows up as an **unclaimed worktree** you can delete by
  hand; a dirty one is never deleted automatically.

## Features

### Task list
- Recency ordering across projects, with project grouping as a toggle
- Filter box, state dots (`busy` / `idle` / `needs_attention`), and the agent's
  last message as the second line
- Archived tasks behind a toggle; unclaimed worktrees surfaced with a delete
- Per-project `+` opens the composer with that project preselected

### Tabs and splits
- The agent terminal is tab one and cannot be closed
- Diffs, files, commits, history, and extra shells open as sibling tabs
- Drag to reorder, drag between groups, split read-only tabs side by side
- Preview tabs: a single click opens an italic tab the next click replaces
- Layout persists per task, per device

### Explorer
A collapsible right-hand rail with five sections — **Changes**, **Files**,
**History**, **Refs**, and **Backlog** (present only in a Backlog.md
repository). Clicking a section opens it; clicking the one already showing hides
the panel. Selections open tabs rather than filling a pane below the tree.

### Terminal
- Full terminal emulation with `@xterm/xterm` and 10,000 lines of scrollback
- Server-side authoritative state via `@xterm/headless` — reconnect without
  losing output, and multiple browsers can watch the same terminal
- Size negotiation (smallest-wins across attached views; a hidden tab does not
  constrain anyone)
- `TERM=xterm-256color`, clickable URLs, touch scrolling, resize HUD, and
  in-terminal search with match highlighting

### Code review
- Unified diff parsing with word-level highlighting and tree-sitter tokenization
- Inline and file-level comments; generate an agent prompt from the feedback
- Hierarchical file tree, single-file and all-files modes, expandable context
- Rename and copy detection, including pure moves; image diffs

### Git
- Commit history over `git log --all --topo-order`, virtualized with
  auto-pagination and a coloured commit graph
- Filterable ref sidebar (branches, remotes, tags) with a `/`-delimited folder
  tree; selecting a ref fetches until its SHA
- Three modes per commit: metadata, changes, and the tree at that commit
- Pinned "Local Changes" row for the working-tree diff

### Files and code intelligence
- Directory tree, syntax-highlighted contents, line wrap toggle, Markdown
  preview with Mermaid rendering, git-based file search, recent files
- Server-side tree-sitter highlighting across ~18 languages, shared by the file
  browser and the diff viewer, with a client-side regex fallback so highlighting
  never blocks the view
- Per-repository symbol index (tree-sitter tags, mtime-revalidated) for TS/JS,
  Python, Go, Rust, Ruby, Java, and C/C++; Cmd/Ctrl+click any symbol for a
  definitions/references popover

### Command palette
⌘⇧P (Ctrl+Shift+P) opens one palette over everything: open tabs, tasks, actions
(new/close/resume/archive a task, new shell, every leader chord that would
actually do something here, find in terminal, toggle either sidebar), changed
files, commits, refs, and a file search.

### Keyboard shortcuts

| Action | Mac | Windows/Linux |
|--------|-----|---------------|
| Command palette | ⌘⇧P | Ctrl+Shift+P |

The palette is the one shortcut not behind the leader, because it is what
*lists* the leader's chords — and runs them.

Tabs, splits, and groups are driven from a leader chord: press **⌘K**
(**Ctrl+Shift+K** elsewhere), release, then press the key below.

| Action | Chord |
|--------|-------|
| Next tab | ⌘K `]` |
| Previous tab | ⌘K `[` |
| Go to tab 1–9 | ⌘K `1`…`9` |
| Close tab | ⌘K `W` |
| Split tab | ⌘K `\` |
| Focus group left / right | ⌘K `←` / `→` |
| Focus agent tab | ⌘K `A` |
| New shell | ⌘K `` ` `` |

A leader rather than the usual chords because both neighbours are occupied:
Chrome owns every conventional next-tab chord on macOS, and the agent below is a
terminal, which wants nearly every bare Ctrl chord. The leader stays armed for
three seconds; Escape cancels it. Chords act on the tab in front and move the
caret with them, and each is on the tooltip of the control that does the same
thing.

Elsewhere:

| Action | Mac | Windows/Linux |
|--------|-----|---------------|
| Submit a prompt from the composer | ⌘⏎ | Ctrl+Enter |
| Find in terminal | ⌘F | Ctrl+F |
| Next / previous match | ⌘G / ⌘⇧G | Ctrl+G / Ctrl+Shift+G |
| Prev/Next file (diff, git changes) | ← / → | ← / → |
| Go to definition | ⌘+click symbol | Ctrl+click symbol |

### Mobile
Below 48rem the shell is a phone: one tab group, no splits, and both sidebars
render as sheets. Touch scrolling, pinch, and the keyboard viewport are handled.

### Customization
- 100+ terminal colour schemes with a palette preview
- 5 font families (JetBrains Mono, Fira Code, Hack, MesloLGS, Cascadia Code —
  all Nerd Font Mono), adjustable size
- App theme: system, light, or dark
- Preferences persisted to localStorage

### Notifications and upload
- Desktop notifications via OSC 777, OSC 9, and OSC 99 (Kitty protocol), plus
  browser notifications when the window is not focused
- Notification sounds: chime, bell, drop, ping, with a separate BEL control
- Drag files onto a terminal, or paste an image from the clipboard; the uploaded
  paths are injected into the shell

## Upgrading from v1

The database at `~/.codetoaster/data.db` carries over. On the first v2 start it
is migrated in place: every project keeps its name, path and order, and gains
the per-project task defaults (worktrees off, base ref, model and permission
mode unset, so a new task follows HEAD and Claude Code's own defaults until you
change them in the project's settings). The migration runs once and needs
nothing from you.

v1 sessions are not carried over. They were live shell processes with no state
on disk, and v2 has no equivalent for a bare session: every task is an agent
task, and plain shells exist only as extra tabs inside one. Anything you were
running in a v1 session is gone once the v1 daemon stops, so finish or note it
before upgrading.

## Getting started

```bash
bun install
```

### Development

```bash
bun run dev
```

Starts the TanStack Router watcher and Bun dev server in the foreground with hot
reload on port 4000. See the warning under [Agent integration](#never-start-the-daemon-from-inside-a-claude-code-session)
before running this from inside an agent session.

### Production

```bash
bun run start
```

### Build a standalone binary

```bash
bun run build:server
```

Produces a `codetoaster` binary in `dist-executables/`.

## CLI

The default command starts a background daemon; every subcommand talks to it
over HTTP.

```
Usage: codetoaster [command] [options]

Commands:
  (default)       Start daemon in background
  foreground, fg  Run server in foreground (no detach)
  list, ls        List sessions
  kill <session>  Kill a session by name or ID prefix
  connections     List connected WebSocket clients
  open            Open web UI in default browser
  stop            Stop the daemon
  status          Check if daemon is running
  instances       List all running instances (across all ports)
  hook            Report a Claude Code hook to the daemon (run by the agent)
  help            Show this help message

Options:
  --port <port>   Server port (default: 4000, or PORT env)
  --db <path>     Database path (default: ~/.codetoaster/data.db)
  --host <addr>   Address to bind (default: 127.0.0.1; widen at your own risk)
  --allowed-host <name>  Extra host name the UI may be reached by (repeatable)
  --version       Show version
  --help          Show this help message
```

`list` and `kill` act on **tasks**. `kill` matches a task by title, id, or id
prefix, and takes its checkout with it — it does not delete a branch whose
commits are nowhere else, and says which branch it kept.

```bash
codetoaster                     # start the daemon
codetoaster ls                  # tasks with cwd, client count, size, age
codetoaster kill fix-the-parser # kill a task by title or id prefix
codetoaster open                # open the web UI
codetoaster stop                # stop the daemon
```

The daemon stores its PID file and logs in `~/.codetoaster/`.

## Agent integration

### Hooks

Each task gets its own `~/.codetoaster/tasks/<task-id>/settings.json`, passed to
the agent as `claude --settings`. It registers a single command — `codetoaster
hook` — against the Claude Code events the task list is built from:
`SessionStart`, `UserPromptSubmit`, `Stop`, `Notification`, `SessionEnd`,
`PreCompact`. The subcommand reads the payload from stdin and POSTs it to the
daemon, which is what turns "some bytes came out of a PTY 300ms ago" into a real
`busy` / `idle` / `needs_attention`. Injected settings *merge* with your own
hooks rather than shadowing them, so nothing you have configured stops firing.

**You should never need to run `codetoaster hook` by hand.** It does nothing at
all without `CODETOASTER_TASK_ID` and `CODETOASTER_PORT`, which the daemon puts
in the task's PTY environment.

Three properties of the reporter are hard requirements, because hooks run
synchronously in the agent's own path:

- **It prints nothing to stdout.** `SessionStart` stdout is injected into the
  conversation as context, so one stray line would poison every turn.
- **It always exits 0.** A non-zero exit shows up in the agent's transcript, and
  nothing this process can discover is the agent's problem.
- **It gives up inside about a second.** A daemon that is down, wedged, or on a
  port that now belongs to someone else must never stall a keystroke.

If hooks are unavailable, tasks fall back to the output-activity heuristic and
`--continue` for resume. A missing hook degrades the UI; it never makes a task
unusable.

### Harvesting and eviction

A sweep runs every 30 seconds. A live task is **harvested** — its scrollback
snapshotted, its PTYs killed, its row marked suspended — only when *all* of
these hold: the agent reported `idle`, no client has a view attached, no shell
tab has a foreground process, and it has been idle longer than `harvest_after`.

- `harvest_after` defaults to **30 minutes**. `0` disables idle harvesting
  entirely.
- A suspended task's worktree is **evicted** after a base grace of **7 days**,
  scaled by what its last setup command cost (up to 4×), so a task that restores
  in 200ms is reclaimed long before one that re-runs a 90-second install. Pinned
  tasks are exempt.

**Neither is configurable yet.** There is no flag, environment variable, or
settings control for `harvest_after` or the eviction grace — the defaults above
are what you get. Manual close and manual archive are the escape hatches.

### Never start the daemon from inside a Claude Code session

Start the daemon from a normal shell — your terminal, launchd, systemd — not
from a terminal that is already inside a Claude Code session.

A process spawned from inside an agent session inherits `CLAUDECODE`,
`CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_SESSION_ID`, and friends, and the
daemon passes its environment to the agents it spawns. Those markers disable
transcript saving in the child (`⚠ Transcript saving is off — inherited
CLAUDE_CODE_CHILD_SESSION marker`): no transcript on disk, and therefore nothing
for `claude --resume` to come back to. The daemon is long-lived, so one poisoned
start quietly degrades every task it spawns afterwards, with a symptom that
surfaces nowhere near the cause.

The spawn path scrubs those variables as insurance, and on a normally started
daemon the scrub does nothing. Treat it as a backstop, not a licence — and note
that `bun run dev` from an agent session is the same hazard.

## Tech stack

- **Runtime:** [Bun](https://bun.sh)
- **Server:** `Bun.serve()` with WebSocket and HTML imports
- **Database:** `bun:sqlite`
- **Frontend:** React 19, TanStack Router (file-based), TanStack Query,
  Tailwind CSS 4
- **Terminal:** `@xterm/xterm` (client) + `@xterm/headless` (server)
- **Terminal addons:** fit, search, serialize, web-links
- **Code intelligence:** `web-tree-sitter` (WASM grammars) for server-side
  highlighting and symbol tags
- **PTY:** `Bun.spawn()` with `pty: true`
- **Styling:** `bun-plugin-tailwind`, Radix UI, Lucide icons
- **Build:** `@tanstack/router-cli` (`tsr`) for route generation
