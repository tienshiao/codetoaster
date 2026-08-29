import { test, expect, describe, afterEach } from "bun:test";
import { configureOriginGuard, guardApiRoutes, guardRoute, isOurHost, isSameOrigin, resetOriginGuard } from "./origin";

afterEach(() => resetOriginGuard());

describe("isOurHost", () => {
  // The half that makes the Origin comparison mean anything. Without it the
  // guard compares two headers the same attacker wrote.
  test("refuses a name that DNS could point anywhere", () => {
    configureOriginGuard({ port: 4000, hostname: "127.0.0.1" });
    // A rebinding page: `evil.test` resolves to 127.0.0.1 on its second
    // lookup, and the browser then sends both of these itself.
    expect(isOurHost("evil.test:4000")).toBe(false);
    expect(isSameOrigin("http://evil.test:4000", "evil.test:4000")).toBe(false);
  });

  test("accepts the names that cannot be pointed somewhere else", () => {
    configureOriginGuard({ port: 4000, hostname: "127.0.0.1" });
    expect(isOurHost("localhost:4000")).toBe(true);
    expect(isOurHost("127.0.0.1:4000")).toBe(true);
    expect(isOurHost("[::1]:4000")).toBe(true);
    expect(isOurHost("192.168.1.20:4000")).toBe(true);
  });

  test("accepts the name the user deliberately bound", () => {
    configureOriginGuard({ port: 4000, hostname: "mymac.local" });
    expect(isOurHost("mymac.local:4000")).toBe(true);
    expect(isOurHost("evil.test:4000")).toBe(false);
  });

  test("refuses another server on another port of this machine", () => {
    configureOriginGuard({ port: 4000, hostname: "127.0.0.1" });
    expect(isOurHost("127.0.0.1:3000")).toBe(false);
  });

  test("refuses a missing or unparseable Host", () => {
    configureOriginGuard({ port: 4000, hostname: "127.0.0.1" });
    expect(isOurHost(null)).toBe(false);
    expect(isOurHost("not a host")).toBe(false);
  });
});

describe("isSameOrigin", () => {
  test("accepts a page served from this very daemon", () => {
    configureOriginGuard({ port: 4000, hostname: "127.0.0.1" });
    expect(isSameOrigin("http://localhost:4000", "localhost:4000")).toBe(true);
    configureOriginGuard({ port: 4599, hostname: "127.0.0.1" });
    expect(isSameOrigin("http://127.0.0.1:4599", "127.0.0.1:4599")).toBe(true);
  });

  // The whole point: a page the user happened to open, talking to the daemon
  // running behind it.
  test("refuses a page that is not this daemon", () => {
    configureOriginGuard({ port: 4000, hostname: "127.0.0.1" });
    expect(isSameOrigin("https://evil.example", "localhost:4000")).toBe(false);
    // Same host, different port: a different origin, and a different server.
    expect(isSameOrigin("http://localhost:3000", "localhost:4000")).toBe(false);
    // A host that merely starts the same way.
    expect(isSameOrigin("http://localhost:4000.evil.example", "localhost:4000")).toBe(false);
  });

  // Browsers always attach an Origin cross-origin, so its absence means the
  // caller is not a browser — the CLI, a curl, the server fetching its own SPA.
  test("allows a caller that is not a browser at all", () => {
    configureOriginGuard({ port: 4000, hostname: "127.0.0.1" });
    expect(isSameOrigin(null, "localhost:4000")).toBe(true);
  });

  test("refuses an opaque origin, which is a browser and is never us", () => {
    configureOriginGuard({ port: 4000, hostname: "127.0.0.1" });
    // A sandboxed iframe or a file:// page.
    expect(isSameOrigin("null", "localhost:4000")).toBe(false);
    expect(isSameOrigin("not a url", "localhost:4000")).toBe(false);
  });

  // A user who deliberately binds wider reaches the UI on that address, and
  // the page's origin is that address too — which is why this compares against
  // the request's own Host rather than a list of names.
  test("follows the daemon wherever it is bound", () => {
    configureOriginGuard({ port: 4000, hostname: "0.0.0.0" });
    expect(isSameOrigin("http://192.168.1.20:4000", "192.168.1.20:4000")).toBe(true);
    expect(isSameOrigin("http://192.168.1.20:4000", "localhost:4000")).toBe(false);
  });
});

const servers: Array<{ stop: (force?: boolean) => void }> = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

function serveGuarded() {
  const server = Bun.serve({
    port: 0,
    routes: {
      ...guardApiRoutes({
        "/api/thing": {
          GET: () => new Response("read"),
          POST: () => new Response("written"),
        },
      }),
      "/api/inline": guardRoute({ POST: () => new Response("inline") }),
      // Not guarded: a top-level navigation legitimately carries no Origin.
      "/page": { GET: () => new Response("<html>", { headers: { "content-type": "text/html" } }) },
    },
    fetch: () => new Response("", { status: 404 }),
  });
  servers.push(server);
  return `http://localhost:${server.port}`;
}

describe("the guarded API", () => {
  test("refuses a request from another page, with a body that says so", async () => {
    const base = serveGuarded();
    const res = await fetch(`${base}/api/thing`, {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });

    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("Cross-origin");
  });

  test("guards reads as well as writes", async () => {
    const base = serveGuarded();
    // A cross-origin GET cannot read the answer without CORS headers, but
    // GET /api/tasks has side effects, and "this read is harmless" ages badly.
    const res = await fetch(`${base}/api/thing`, { headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(403);
  });

  test("guards a route declared on its own, not only a whole table", async () => {
    const base = serveGuarded();
    const res = await fetch(`${base}/api/inline`, {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  test("lets our own page through", async () => {
    const base = serveGuarded();
    const res = await fetch(`${base}/api/thing`, {
      method: "POST",
      headers: { origin: base },
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("written");
  });

  test("lets the CLI through, which sends no Origin", async () => {
    const base = serveGuarded();
    const res = await fetch(`${base}/api/thing`, { method: "POST" });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("written");
  });

  test("leaves the SPA alone", async () => {
    const base = serveGuarded();
    const res = await fetch(`${base}/page`, { headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(200);
  });
});
