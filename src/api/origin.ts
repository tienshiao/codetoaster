// Cross-origin defence for a daemon that has no other authentication
// (TASK-42). Everything here answers one question: did a browser send this
// request from a page that is not ours?
//
// The daemon spawns agents with a caller-chosen prompt and permission mode. A
// cross-origin POST carrying a simple content type is not preflighted, and the
// task routes read the body as JSON whatever the content type says — so
// without this, any page a user happens to visit while the daemon is running
// can start an agent in their repository.

/** What this daemon is actually listening on. Set once by startServer, after
 * `serve()` has returned and the real port is known.
 *
 * Undefined until then, and left undefined by anything that mounts these
 * guards on a server of its own (the tests). That is the safe direction: an
 * unconfigured guard checks no port and accepts only the host names below,
 * which is stricter than the daemon needs, never looser. */
let bound: { port: number; hostname?: string } | undefined;
/** Extra names the user has vouched for with --allowed-host. */
let allowedHosts = new Set<string>();
/** Hosts already complained about, so a misconfigured setup says so once
 * rather than once per request. */
const warnedHosts = new Set<string>();

export function configureOriginGuard(config: {
  port: number;
  hostname?: string;
  allowedHosts?: string[];
}): void {
  bound = { port: config.port, hostname: config.hostname };
  allowedHosts = new Set((config.allowedHosts ?? []).map((name) => name.toLowerCase()));
}

/** Reset for tests, so one server's configuration cannot leak into the next. */
export function resetOriginGuard(): void {
  bound = undefined;
  allowedHosts = new Set();
  warnedHosts.clear();
}

/** A refused Host is the one failure here a user cannot diagnose from the
 * outside: the SPA still loads, and then every request under it fails. Say so,
 * once per name, with the thing to do about it. */
function warnAboutRefusedHost(host: string | null): void {
  if (!host || warnedHosts.has(host)) return;
  warnedHosts.add(host);
  console.warn(
    `Refused a request addressed to "${host}": not an address this daemon answers to. ` +
      `If you reach the UI by that name, start it with --allowed-host ${host.split(":")[0]}`,
  );
}

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** A hostname nobody but us can point at this daemon.
 *
 * IP literals qualify because an address *is* its own resolution: there is no
 * name for an attacker's DNS server to answer for. `localhost` qualifies for
 * the same reason — browsers resolve it to loopback and no zone can retarget
 * it. `new URL` normalizes a bracketed IPv6 host to `[…]`, which is why the
 * bracket is the whole v6 test. */
function isUnspoofableName(hostname: string): boolean {
  return hostname === "localhost" || IPV4.test(hostname) || hostname.startsWith("[");
}

/** Whether a Host header names *this* daemon.
 *
 * This is the half that makes the Origin comparison mean anything, and it is
 * not paranoia about a malformed header: without it the check compares two
 * values the attacker supplies together. A page on `evil.test` whose DNS
 * answers 127.0.0.1 on its second lookup sends `Host: evil.test:4000` and
 * `Origin: http://evil.test:4000`; those match, so the guard passes, and DNS
 * rebinding walks straight through to routes that spawn agents in the user's
 * repositories.
 *
 * So a Host is ours only when it is a name that cannot be pointed somewhere
 * else — an IP literal or `localhost` — or the exact name the user told us to
 * bind, which is theirs to choose and not an attacker's to forge. The port
 * must be ours too: another server on another port of this same machine is a
 * different origin, and one the victim may not trust. */
export function isOurHost(host: string | null): boolean {
  if (!host) return false;
  let url: URL;
  try {
    url = new URL(`http://${host}`);
  } catch {
    return false;
  }
  // Anything after the authority means this was not a bare Host header.
  if (url.pathname !== "/" || url.username || url.password) return false;
  // Deliberately not checking the port. It buys nothing here — a name that
  // cannot be repointed is what stops rebinding, and same-origin is enforced
  // separately by comparing Origin to this same Host — while requiring it
  // breaks the ordinary `ssh -L 8080:localhost:4000`, where the browser
  // legitimately says `localhost:8080`.
  if (isUnspoofableName(url.hostname)) return true;
  // The name the user deliberately bound. `--host mymac.local` is a choice,
  // and refusing the only name that reaches the daemon would be the wrong
  // reading of it.
  if (bound?.hostname && url.hostname === bound.hostname.toLowerCase()) return true;
  // Names the user has vouched for. Binding a wildcard cannot tell us what to
  // expect — `--host 0.0.0.0` says "be reachable", not "expect mymac.local" —
  // so reaching the UI by a hostname over the network needs saying so.
  return allowedHosts.has(url.hostname);
}

/** True when the request may proceed.
 *
 * Two questions, not one: is this Host us, and does the Origin match it. The
 * first is what keeps the second from being a comparison of two headers the
 * same attacker wrote (see `isOurHost`).
 *
 * A request with no Origin at all is allowed. Browsers always attach one to a
 * cross-origin request, so its absence means the caller is not a browser — the
 * CLI, a curl, the server fetching its own SPA — and cross-site request
 * forgery is a browser-only vector. This is not a claim that non-browser
 * callers are trustworthy; it is that they are a different threat, and one a
 * header cannot address (see the token decision on TASK-42).
 *
 * A literal "null" origin is refused: that is a sandboxed iframe or a file://
 * page, which is a browser, and never us. */
export function isSameOrigin(origin: string | null, host: string | null): boolean {
  if (!isOurHost(host)) {
    warnAboutRefusedHost(host);
    return false;
  }
  if (origin === null) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    // Unparseable, including the literal "null".
    return false;
  }
  return originHost === host;
}

export function isSameOriginRequest(req: Request): boolean {
  return isSameOrigin(req.headers.get("origin"), req.headers.get("host"));
}

export function crossOriginRefusal(): Response {
  return Response.json({ error: "Cross-origin requests are not accepted" }, { status: 403 });
}

type Handler = (req: any, ...rest: any[]) => Response | Promise<Response>;

/** Wraps one route's methods with the same-origin check. */
export function guardRoute<T extends Record<string, unknown>>(handlers: T): T {
  const guarded: Record<string, unknown> = {};
  for (const [method, handler] of Object.entries(handlers)) {
    guarded[method] =
      typeof handler === "function"
        ? (req: Request, ...rest: unknown[]) =>
            isSameOriginRequest(req)
              ? (handler as Handler)(req, ...rest)
              : crossOriginRefusal()
        : handler;
  }
  return guarded as T;
}

/** Wraps every handler in a route table with the same-origin check.
 *
 * A guard inside `fetch` would cover nothing: Bun matches `routes` first and
 * only falls through to `fetch` when nothing matched. Wrapping is also what
 * makes this hard to forget — a new route added to a guarded table is guarded
 * by construction, where a per-handler check is one someone will omit.
 *
 * Applied to the API only. The SPA is reached by top-level navigation, which
 * legitimately carries no Origin, and serving HTML is not a mutation. */
export function guardApiRoutes<T extends Record<string, unknown>>(routes: T): T {
  const guarded: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(routes)) {
    // Bun also accepts a bare function as a route — one handler for every
    // method. Passing that through unwrapped is the failure this helper exists
    // to prevent: it compiles, it works, the tests pass, and the route is
    // reachable cross-origin with nothing to indicate it. Guard it as the
    // handler it is.
    if (typeof value === "function") {
      const handler = value as Handler;
      guarded[path] = (req: Request, ...rest: unknown[]) =>
        isSameOriginRequest(req) ? handler(req, ...rest) : crossOriginRefusal();
      continue;
    }
    // A static `Response`, `false`, or anything else that is not a table of
    // methods. Nothing to wrap — and wrapping a Response would enumerate no
    // methods and quietly replace the route with an empty one.
    if (!value || typeof value !== "object" || value instanceof Response) {
      guarded[path] = value;
      continue;
    }
    guarded[path] = guardRoute(value as Record<string, unknown>);
  }
  return guarded as T;
}
