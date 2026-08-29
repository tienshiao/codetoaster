---
id: TASK-42
title: 'The HTTP API accepts cross-origin requests, so any page can spawn an agent'
status: Done
assignee:
  - '@claude'
created_date: '2026-08-29 06:33'
updated_date: '2026-08-29 07:50'
labels:
  - server
  - security
milestone: m-5
dependencies: []
documentation:
  - docs/v2-architecture.md
priority: high
ordinal: 42000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
src/server.ts sets no Origin check and no token on any route. A cross-origin POST with a simple content type is not preflighted by the browser, and POST /api/tasks calls req.json() without looking at the content type — so any page a user visits while the daemon is running can create a task in their working directory, choosing both the prompt and the permission mode. permissionMode is passed straight through to the agent's argv, and bypassPermissions is a valid value.

The exposure class is pre-existing: v1's WebSocket already accepted create and input with no authentication. What changed is the payload. v1 could spawn the user's shell with no arguments; v2 spawns an agent with an attacker-chosen prompt and an attacker-chosen permission mode, over plain HTTP, in a repository the user cares about. The daemon also binds 0.0.0.0, so the same requests reach it from the LAN without a browser involved.

This needs a decision rather than a patch, which is why it is its own task:
- an Origin/Host allowlist on every mutating route, which is the cheapest thing that stops the browser-driven case;
- a token minted at daemon start, written to ~/.codetoaster/ alongside the pid file, required by the API and handed to the frontend by the SPA shell — this is what also covers the LAN case;
- binding 127.0.0.1 by default, with 0.0.0.0 opt-in, which should probably happen regardless of the above.

Worth doing before v2 ships, and before the harvester (TASK-15) and worktrees (m-4) give a spawned task more to touch.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A cross-origin POST to any mutating route is refused, and a test asserts it for /api/tasks
- [x] #2 The WebSocket accepts a connection only from an allowed origin, so the socket is not a way around the HTTP check
- [x] #3 The daemon binds 127.0.0.1 by default; exposing it on 0.0.0.0 is an explicit flag
- [x] #4 The frontend and the CLI both still work against the protected daemon, with no manual step for the user
- [x] #5 GET routes that only read are covered too, or there is a written reason why they are not
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. The check is same-origin, not an allowlist of names: a request's Origin host:port must equal its own Host header. That is correct for every bind address — including a deliberate --host 0.0.0.0 where the SPA is served from a LAN address — and needs no list to keep in step with the port. A request with NO Origin is allowed: browsers always attach it cross-origin, so its absence means the caller is not a browser (the CLI, curl), and CSRF is a browser-only vector. Literal "null" (sandboxed iframe, file://) is refused.
2. Applied by wrapping the route tables rather than by a check inside fetch(): Bun matches the routes table before it ever reaches fetch(), so a guard there would cover nothing. A guardApiRoutes helper wraps every method handler under /api and leaves the SPA routes alone — a top-level navigation legitimately carries no Origin, and the HTML import is not a mutation.
3. Every method, not just the mutating ones. A cross-origin GET cannot read our response without CORS headers, but GET /api/tasks has side effects (it refreshes cwd, which spawns processes), and "this GET is harmless" is a claim that ages badly.
4. The WebSocket upgrade gets the same check, in the fetch() handler where it lives. Without it the socket is simply a way around the HTTP guard — it accepts input for any pty the client attaches to.
5. Bind 127.0.0.1 by default, with --host to opt into anything wider. This is the half that covers the non-browser LAN case, and it should have been the default regardless.
6. NOT doing a token, deliberately. It would add protection only against a non-browser attacker already running as this user on this machine — a threat that can read ~/.codetoaster and the token with it. It costs the CLI and the frontend a credential to carry, and buys little for a local dev tool. Recorded here so the decision is visible rather than forgotten; say the word and it is a small follow-up.
7. Tests: the origin predicate directly; the route guard through a real Bun.serve (cross-origin refused, same-origin allowed, absent Origin allowed, literal null refused); and the WebSocket upgrade refused cross-origin.
8. Then /code-review --fix and /verify.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Same-origin guard on every /api route and on the WebSocket upgrade, plus a loopback default bind and a --host flag to widen it deliberately.

The design I planned was wrong, and code review caught it: comparing Origin against Host proves nothing, because a DNS-rebinding page controls BOTH headers. A page served from evil.test:4599, rebound to 127.0.0.1, sends Origin http://evil.test:4599 and Host evil.test:4599, they match, and it passes on every route including the socket. The check now requires Host to name something that cannot be repointed — an IP literal, localhost, or the exact name the user bound — on our own port. LAN browsing on a wide bind still works because that Host is an IP literal.

Review also found a straight SSRF next door: the SPA fallback route built its internal fetch URL from new URL(req.url).origin, which Bun derives from the caller's Host header, so a forged Host made the daemon fetch an attacker's server and hand back that body as its own HTML. Pinned to the listener's own address.

And --host, as first written, broke the two callers that assumed loopback: the CLI printed "Daemon started but not responding" and exited 1 against the healthy daemon it had just launched, and every hook POST was dropped. The daemon now records its origin in the pid file and passes CODETOASTER_ORIGIN to agents.

Deliberately NOT doing a token. It would only defend against a non-browser attacker already running as this user on this machine — who can read ~/.codetoaster and the token with it — and it costs the CLI and the frontend a credential to carry. Recorded so the decision is visible rather than forgotten.

Runtime verification against a live daemon:
- cross-origin POST /api/tasks with a bypassPermissions body -> 403
- the DNS-rebinding shape (attacker sets both Host and Origin) -> 403
- our own page -> 200; the CLI, which sends no Origin -> 200
- WebSocket upgrade: cross-origin refused, same-origin and no-origin connect
- the SSRF: a forged Host returns our own SPA and the sink server was never contacted
- lsof confirms the listener is 127.0.0.1 only
- with --host <lan-ip>: serves on the LAN address, refuses loopback, still refuses cross-origin, and a task's hooks reach the non-loopback daemon (agent_state idle, last_message captured)
bun test 394 pass / 0 fail; bunx tsc --noEmit clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Every /api route and the WebSocket upgrade now require a same-origin request, and the daemon binds 127.0.0.1 unless --host says otherwise. The guard rejects a Host that could have been repointed by DNS rebinding rather than merely comparing Origin to Host, which an attacker controls on both sides. Verified live: the original cross-origin agent-spawn is refused, so is the rebinding shape, the SPA-proxy SSRF found alongside it no longer reaches an external server, and the frontend, the CLI and the hook reporter all still work — including against a deliberately widened --host bind.
<!-- SECTION:FINAL_SUMMARY:END -->
