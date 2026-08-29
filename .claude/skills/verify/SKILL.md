---
name: verify
description: Build/launch/drive recipe for verifying codetoaster changes at runtime (server API + frontend).
---

# Verifying codetoaster

## Launch an isolated instance

```sh
bun src/index.ts foreground --port 4599 --db /tmp/verify.db
```

Run from the repo root (new sessions inherit the server's cwd, so they land in
this git repo — needed for the diff/file/git endpoints). `foreground` skips the
daemon/PID-file machinery; `--db` isolates state from `~/.codetoaster/`. Ready
when `curl -s -o /dev/null -w "%{http_code}" http://localhost:4599/` → 200.

## Create a task (required before any /api/tasks/:id/* call)

Tasks are created over the WebSocket protocol, not HTTP. Endpoint is
`ws://localhost:4599/terminal`.

**The two ids are different things.** A task is the durable work and owns the
row, the URL and every HTTP route; a PTY is a terminal it happens to be running
right now, and gets a server-minted id. `create`, `kill`, `rename` and
`acknowledge` name the task; `attach`, `detach`, `input` and `resize` name the
terminal. `attached` is the message that pairs them, and it arrives *before*
the PTY's `restore`. Naming a PTY you never attached to is rejected; omitting
`ptyId` from `detach` drops every terminal the socket holds.

```ts
const ws = new WebSocket("ws://localhost:4599/terminal");
const taskId = crypto.randomUUID();
ws.onopen = () =>
  ws.send(JSON.stringify({ type: "create", taskId, cols: 120, rows: 30 }));
ws.onmessage = (ev) => {
  const msg = JSON.parse(String(ev.data));
  if (msg.type === "attached" && msg.taskId === taskId) {
    console.log(`task ${taskId} is running on pty ${msg.ptyId}`);
    ws.send(JSON.stringify({ type: "detach" }));
    process.exit(0);
  }
};
```

The task and its PTY survive detach — the task id stays valid for HTTP calls,
and stays valid after the PTY is gone.

## Drive the API surface

All task-scoped endpoints live under `/api/tasks/<task-id>/…`: `diff`,
`context?file=&line=`, `files`, `files/search?q=`, `file?file=`, `git/log`,
`git/refs`, `git/commit?sha=`, `git/tree?sha=`, `git/file?sha=&file=`,
`image/git?ref=&file=`, `symbols?name=`, `symbols/search?q=`, POST
`diff-tokens` (`{ files, sha? }`). SHAs must be full/abbrev hex (`SHA_RE`);
symbolic refs like `HEAD` are rejected 400 by design.

These read the task row, not a process, so they answer for a task whose PTY is
gone — restart the daemon and hit them again to check that. Two that do need a
live terminal, and 404 without one: `preview` and POST `upload`. A task created
outside any repository has a null `repo_root` and answers 400 "Not a git
repository"; it recovers if its shell cd's into one and a client re-attaches.

An unmatched `/api/…` path is served the SPA's HTML with a 200, not a 404 — so
check the content type before concluding a route still exists.

## Drive the frontend

The UI needs a real browser (Claude-in-Chrome extension or similar) at
`http://localhost:4599/`. Without one, at minimum confirm the bundle compiles
and serves: fetch `/`, extract the `/_bun/client/index-*.js` src, fetch it
(200, ~14MB dev bundle), and grep it for markers of the new code. A Bun HTML
import bundling error surfaces as a failed/erroring chunk request.

## Gotchas

- `bun run dev` spawns tsr + tsc watchers — use `foreground` directly for verification.
- Restarting the daemon suspends every live task (its PTYs died with the parent),
  so the sidebar comes back empty while the rows stay. That is the cheapest way
  to get a task with no process for the route checks above.
- `--db` picks up the migration harness, so a fresh file is a free check that
  migrations apply cleanly: open it with `bun:sqlite` and read `applied_migrations`.
- Write the driver to a file and run `bun <file>`; `bun -e` with top-level
  `await` and a live WebSocket has hung here.
- Kill the server with TaskStop/SIGTERM when done; sessions' PTYs die with it.
- `git/file?file=<directory>` returns git's tree listing as text (200), not 404.
