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

## Create a session (required before any /api/sessions/:id/* call)

Sessions are created over the WebSocket protocol, not HTTP. Endpoint is
`ws://localhost:4599/terminal`. Minimal client (run with `bun`):

Terminal messages are addressed by `ptyId` (protocol v2, §5.3 — a v1 session
*is* a PTY, so this is the same id the HTTP routes take). One socket can hold
several PTYs at once; every `input`/`resize`/`detach` must name the one it
means, and naming a PTY you never attached to is rejected.

```ts
const ws = new WebSocket("ws://localhost:4599/terminal");
const ptyId = crypto.randomUUID();
ws.onopen = () =>
  ws.send(JSON.stringify({ type: "create", ptyId, name: "verify", cols: 120, rows: 30 }));
ws.onmessage = (ev) => {
  const msg = JSON.parse(String(ev.data));
  if (msg.type === "attached" && msg.ptyId === ptyId) {
    console.log(ptyId);
    ws.send(JSON.stringify({ type: "detach" }));
    process.exit(0);
  }
};
```

The session (and its PTY) survives detach — the id stays valid for HTTP calls.

## Drive the API surface

All session-scoped endpoints live under `/api/sessions/<id>/…`: `diff`, `files`,
`file?file=`, `git/log`, `git/refs`, `git/commit?sha=`, `git/tree?sha=`,
`git/file?sha=&file=`, `image/git?ref=&file=`, POST `diff-tokens`
(`{ files, sha? }`). SHAs must be full/abbrev hex (`SHA_RE`); symbolic refs like
`HEAD` are rejected 400 by design.

## Drive the frontend

The UI needs a real browser (Claude-in-Chrome extension or similar) at
`http://localhost:4599/`. Without one, at minimum confirm the bundle compiles
and serves: fetch `/`, extract the `/_bun/client/index-*.js` src, fetch it
(200, ~14MB dev bundle), and grep it for markers of the new code. A Bun HTML
import bundling error surfaces as a failed/erroring chunk request.

## Gotchas

- `bun run dev` spawns tsr + tsc watchers — use `foreground` directly for verification.
- `--db` picks up the migration harness, so a fresh file is a free check that
  migrations apply cleanly: open it with `bun:sqlite` and read `applied_migrations`.
- Write the driver to a file and run `bun <file>`; `bun -e` with top-level
  `await` and a live WebSocket has hung here.
- Kill the server with TaskStop/SIGTERM when done; sessions' PTYs die with it.
- `git/file?file=<directory>` returns git's tree listing as text (200), not 404.
