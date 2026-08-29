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

  // The port is deliberately not part of this check. A page on another port of
  // this machine is still refused — by the Origin comparison, which is where
  // same-origin belongs — while `ssh -L 8080:localhost:4000`, where the
  // browser legitimately says localhost:8080, keeps working.
  test("says nothing about the port, and leaves same-origin to the Origin", () => {
    configureOriginGuard({ port: 4000, hostname: "127.0.0.1" });
    expect(isOurHost("127.0.0.1:3000")).toBe(true);
    // A page served from another local port is still turned away.
    expect(isSameOrigin("http://127.0.0.1:3000", "127.0.0.1:4000")).toBe(false);
    // And a tunnelled browser, which the port check used to break, is not.
    expect(isSameOrigin("http://localhost:8080", "localhost:8080")).toBe(true);
  });

  test("accepts a name the user vouched for, which a wildcard bind cannot infer", () => {
    configureOriginGuard({ port: 4000, hostname: "0.0.0.0", allowedHosts: ["mymac.local"] });
    expect(isOurHost("mymac.local:4000")).toBe(true);
    expect(isSameOrigin("http://mymac.local:4000", "mymac.local:4000")).toBe(true);
    // Still only the names that were vouched for.
    expect(isOurHost("evil.test:4000")).toBe(false);
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

  // No Origin and no Sec-Fetch-Site: the CLI, a curl, the hook reporter.
  test("allows a caller that is not a browser at all", () => {
    configureOriginGuard({ port: 4000, hostname: "127.0.0.1" });
    expect(isSameOrigin(null, "localhost:4000")).toBe(true);
  });

  // The gap an Origin check alone leaves: browsers omit Origin from every
  // subresource load and from top-level navigation, so `new Image().src =
  // "http://127.0.0.1:4000/api/tasks"` on any page reaches a guarded GET with
  // nothing to refuse it. Sec-Fetch-Site is what those requests do carry.
  test("refuses a browser request that carries no Origin", () => {
    configureOriginGuard({ port: 4000, hostname: "127.0.0.1" });
    expect(isSameOrigin(null, "localhost:4000", "cross-site")).toBe(false);
    expect(isSameOrigin(null, "localhost:4000", "same-site")).toBe(false);
  });

  test("allows our own page, and the user typing the address", () => {
    configureOriginGuard({ port: 4000, hostname: "127.0.0.1" });
    expect(isSameOrigin("http://localhost:4000", "localhost:4000", "same-origin")).toBe(true);
    // A bookmark, or a typed URL: a browser, but not another page.
    expect(isSameOrigin(null, "localhost:4000", "none")).toBe(true);
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

  // The shape an `<img src>` on an attacker's page takes: a real browser
  // request, and no Origin on it for the guard to compare.
  test("refuses a subresource load from another page, which carries no Origin", async () => {
    const base = serveGuarded();
    const res = await fetch(`${base}/api/thing`, {
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(res.status).toBe(403);
  });

  test("leaves the SPA alone", async () => {
    const base = serveGuarded();
    const res = await fetch(`${base}/page`, { headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(200);
  });
});
