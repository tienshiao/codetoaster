import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { connect } from "node:net";
import { brotliDecompressSync } from "node:zlib";
import type { Server } from "bun";
import index from "../../test/spa-fixture/index.html";
import { waitFor } from "../../test/wait";
import { BUNDLE_PREFIX, BundleCache, type BundleSource } from "./bundles";
import { encode, type Encoding } from "./compress";
import { spaRoutes } from "./spa";

// The frontend's JS and CSS bundles, compressed (TASK-150). Through a real
// Bun.serve mounting `spaRoutes` the way `server.ts` does, over a fixture HTML
// import built in production mode, and then the cache on its own with a
// source the test controls.

const spaPath = "/hidden-spa";

function startSpa(production: boolean): { server: Server<undefined>; base: string } {
  let server!: Server<undefined>;
  const selfOrigin = () => `http://127.0.0.1:${server.port}`;
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    routes: spaRoutes({ index, spaPath, selfOrigin, production }),
    fetch: () => new Response("Not found", { status: 404 }),
    development: false,
  });
  return { server, base: selfOrigin() };
}

/** The bytes as sent: `decompress: false` stops fetch undoing the encoding. */
async function raw(base: string, path: string, acceptEncoding: string, init: RequestInit = {}) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    decompress: false,
    headers: { "Accept-Encoding": acceptEncoding, ...(init.headers as Record<string, string>) },
  });
  return { res, bytes: new Uint8Array(await res.arrayBuffer()) };
}

/** A request with no Accept-Encoding at all, which Bun's fetch will not send. */
async function rawWithoutAcceptEncoding(port: number, path: string): Promise<{ head: string; body: Buffer }> {
  const sock = connect(port, "127.0.0.1");
  const chunks: Buffer[] = [];
  sock.on("data", (c: Buffer) => chunks.push(c));
  await new Promise<void>((resolve) => sock.once("connect", () => resolve()));
  sock.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
  await new Promise<void>((resolve) => sock.once("close", () => resolve()));
  const all = Buffer.concat(chunks);
  const end = all.indexOf("\r\n\r\n");
  return { head: all.subarray(0, end).toString(), body: all.subarray(end + 4) };
}

const decoders: Record<Encoding, (b: Uint8Array<ArrayBuffer>) => Uint8Array> = {
  gzip: (b) => Bun.gunzipSync(b),
  br: (b) => brotliDecompressSync(b),
  zstd: (b) => Bun.zstdDecompressSync(b),
};

describe("production: the page's bundles, compressed", () => {
  let server: Server<undefined>;
  let base: string;
  let html: string;
  /** Rewritten path → the identity bytes Bun serves at the original path. */
  const originals = new Map<string, Uint8Array<ArrayBuffer>>();

  beforeAll(async () => {
    ({ server, base } = startSpa(true));
    html = await (await fetch(`${base}/`)).text();
    for (const [, path] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const original = path!.replace(BUNDLE_PREFIX, "/");
      const res = await fetch(`${base}${original}`, { headers: { "Accept-Encoding": "identity" } });
      originals.set(path!, new Uint8Array(await res.arrayBuffer()));
    }
  });
  afterAll(() => server.stop(true));

  test("the page points its JS and CSS at the bundle route, keeping the hashed names", () => {
    const paths = [...originals.keys()];
    expect(paths).toHaveLength(2);
    expect(paths.some((p) => /^\/_bundle\/chunk-[a-z0-9]+\.js$/.test(p))).toBe(true);
    expect(paths.some((p) => /^\/_bundle\/chunk-[a-z0-9]+\.css$/.test(p))).toBe(true);
    expect(html).not.toMatch(/"\/chunk-/);
    for (const bytes of originals.values()) expect(bytes.byteLength).toBeGreaterThan(1024);
  });

  test("a dynamic import is inlined, so nothing is loaded relative to the bundle route", () => {
    // The frontend's `import("mermaid")` depends on this: a split chunk loaded
    // by relative path from /_bundle/ would be a name the page never listed.
    const jsPath = [...originals.keys()].find((p) => p.endsWith(".js"))!;
    const jsText = new TextDecoder().decode(originals.get(jsPath));
    expect(jsText).toContain("lazy-fixture-marker");
    expect(jsText).not.toMatch(/chunk-[a-z0-9]+\.js/);
  });

  test("a revalidation with the tag it was sent gets a 304", async () => {
    const [path] = [...originals][0]!;
    const { res: first } = await raw(base, path, "gzip");
    const etag = first.headers.get("etag")!;
    for (const [accept, ifNoneMatch] of [
      ["gzip", etag],
      ["identity", etag],
      ["br", `"other", ${etag.replace(/^W\//, "")}`],
    ]) {
      const { res, bytes } = await raw(base, path, accept!, { headers: { "If-None-Match": ifNoneMatch! } });
      expect(res.status).toBe(304);
      expect(bytes.byteLength).toBe(0);
      expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    }
    const { res: miss } = await raw(base, path, "gzip", { headers: { "If-None-Match": '"other"' } });
    expect(miss.status).toBe(200);
  });

  test("the rewritten page does not carry Bun's tag for the unrewritten one", async () => {
    const page = await fetch(`${base}/`);
    const hidden = await fetch(`${base}${spaPath}`);
    const bunTag = hidden.headers.get("etag");
    expect(bunTag).toBeTruthy();
    expect(page.headers.get("etag")).not.toBe(bunTag);
  });

  for (const encoding of ["gzip", "br", "zstd"] as const) {
    test(`${encoding}: each bundle decodes to Bun's own bytes`, async () => {
      for (const [path, original] of originals) {
        const { res, bytes } = await raw(base, path, encoding);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-encoding")).toBe(encoding);
        expect(res.headers.get("vary")).toBe("Accept-Encoding");
        expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
        expect(res.headers.get("content-type")).toMatch(path.endsWith(".js") ? /^text\/javascript/ : /^text\/css/);
        expect(res.headers.get("etag")).toMatch(/^W\/"/);
        expect(Number(res.headers.get("content-length"))).toBe(bytes.byteLength);
        expect(bytes.byteLength).toBeLessThan(original.byteLength);
        expect(decoders[encoding](bytes)).toEqual(original);
      }
    });
  }

  test("a browser's list gets its best coding, and fetch decodes it", async () => {
    const [path, original] = [...originals][0]!;
    const res = await fetch(`${base}${path}`, { headers: { "Accept-Encoding": "gzip, deflate, br, zstd" } });
    expect(res.headers.get("content-encoding")).toBe("br");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(original);
  });

  test("Accept-Encoding absent: uncompressed, still Vary and immutable", async () => {
    for (const [path, original] of originals) {
      const { head, body } = await rawWithoutAcceptEncoding(server.port!, path);
      expect(head).toMatch(/^HTTP\/1\.1 200/);
      expect(head).not.toMatch(/content-encoding/i);
      expect(head).toMatch(/^vary: Accept-Encoding$/im);
      expect(head).toMatch(/^cache-control: public, max-age=31536000, immutable$/im);
      expect(new Uint8Array(body)).toEqual(original);
    }
  });

  test("identity, or every coding refused: uncompressed, with Bun's strong ETag", async () => {
    const [path, original] = [...originals][0]!;
    const bunEtag = (await fetch(`${base}${path.replace(BUNDLE_PREFIX, "/")}`)).headers.get("etag");
    for (const header of ["identity", "*;q=0", "gzip;q=0", "deflate"]) {
      const { res, bytes } = await raw(base, path, header);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-encoding")).toBeNull();
      expect(res.headers.get("vary")).toBe("Accept-Encoding");
      expect(res.headers.get("etag")).toBe(bunEtag);
      expect(bytes).toEqual(original);
    }
  });

  test("HEAD answers the headers with no body", async () => {
    const [path] = [...originals][0]!;
    const { res, bytes } = await raw(base, path, "gzip", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(bytes.byteLength).toBe(0);
  });

  test("only GET and HEAD are answered", async () => {
    const [path] = [...originals][0]!;
    for (const method of ["POST", "PUT", "DELETE"]) {
      const res = await fetch(`${base}${path}`, { method });
      expect(res.status).toBe(404);
    }
  });

  test("a hash the page does not name is a 404, under either path", async () => {
    for (const path of ["/_bundle/chunk-deadbeef.js", "/_bundle/chunk-deadbeef.css", "/chunk-deadbeef.js"]) {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("Not found");
    }
  });

  test("nothing but a named bundle can be reached through it", async () => {
    for (const path of [
      "/_bundle/api%2Fping",
      "/_bundle/..%2Fapi%2Fping",
      "/_bundle/hidden-spa",
      "/_bundle/index.html",
      "/_bundle/chunk-deadbeef.map",
    ]) {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type") ?? "").not.toMatch(/^text\/html/);
    }
  });
});

describe("development: nothing is rewritten", () => {
  let server: Server<undefined>;
  let base: string;
  beforeAll(() => ({ server, base } = startSpa(false)));
  afterAll(() => server.stop(true));

  test("the page keeps Bun's paths and there is no bundle route", async () => {
    const html = await (await fetch(`${base}/`)).text();
    expect(html).toMatch(/"\/chunk-[a-z0-9]+\.js"/);
    expect(html).not.toContain(BUNDLE_PREFIX);
    const name = html.match(/"\/(chunk-[a-z0-9]+\.js)"/)![1];
    expect((await fetch(`${base}${BUNDLE_PREFIX}${name}`)).status).toBe(404);
  });
});

// The cache with a source the test controls.

const js = new TextEncoder().encode(`console.log(${JSON.stringify("x ".repeat(4000))});`);
const page = `<!doctype html><link rel="stylesheet" crossorigin href="/chunk-css1.css"><script type="module" crossorigin src="/chunk-js1.js"></script>`;

function bundleResponse(body: Uint8Array = js, type = "text/javascript;charset=utf-8"): Response {
  return new Response(body as Uint8Array<ArrayBuffer>, { headers: { "Content-Type": type, ETag: "bareToken" } });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** A source counting what it was asked, answering from `bundle` and `html`. */
function fakeSource(opts: { bundle?: (name: string) => Promise<Response>; html?: () => Promise<Response> } = {}) {
  const calls = { bundle: [] as string[], html: 0 };
  const source: BundleSource = {
    fetchBundle: (name) => {
      calls.bundle.push(name);
      return opts.bundle ? opts.bundle(name) : Promise.resolve(bundleResponse());
    },
    fetchHtml: () => {
      calls.html++;
      return opts.html ? opts.html() : Promise.resolve(new Response(page, { headers: { "Content-Type": "text/html" } }));
    },
  };
  return { source, calls };
}

function countingEncoder() {
  const calls: Encoding[] = [];
  const encoder = (encoding: Encoding, body: Uint8Array) => {
    calls.push(encoding);
    return encode(encoding, body);
  };
  return { encoder, calls };
}

const get = (name: string, acceptEncoding = "gzip", method = "GET") =>
  new Request(`http://daemon.test${BUNDLE_PREFIX}${name}`, { method, headers: { "Accept-Encoding": acceptEncoding } });

describe("BundleCache", () => {
  test("rewrites only root-relative chunk references, in either quote", () => {
    const cache = new BundleCache(fakeSource().source);
    const html =
      `<script src="/chunk-a1.js"></script><link href='/chunk-b2.css'>` +
      `<script src="/vendor.js"></script><script src="https://cdn.test/chunk-c3.js"></script>` +
      `<script src="/_bun/client/index-00.js"></script><p>/chunk-d4.js</p>`;
    expect(cache.rewriteHtml(html)).toBe(
      `<script src="/_bundle/chunk-a1.js"></script><link href='/_bundle/chunk-b2.css'>` +
        `<script src="/vendor.js"></script><script src="https://cdn.test/chunk-c3.js"></script>` +
        `<script src="/_bun/client/index-00.js"></script><p>/chunk-d4.js</p>`,
    );
  });

  test("concurrent first loads share one fetch and one encode", async () => {
    const gate = deferred<Response>();
    const { source, calls } = fakeSource({ bundle: () => gate.promise });
    const { encoder, calls: encodes } = countingEncoder();
    const cache = new BundleCache(source, encoder);
    cache.rewriteHtml(page);

    const pending = Array.from({ length: 6 }, () => cache.serve(get("chunk-js1.js"), "chunk-js1.js"));
    gate.resolve(bundleResponse());
    const responses = await Promise.all(pending);
    const bodies = await Promise.all(responses.map(async (r) => new Uint8Array(await r.arrayBuffer())));

    expect(calls.bundle).toEqual(["chunk-js1.js"]);
    expect(encodes).toEqual(["gzip"]);
    for (const [i, res] of responses.entries()) {
      expect(res.headers.get("content-encoding")).toBe("gzip");
      expect(Bun.gunzipSync(bodies[i]!)).toEqual(js);
    }

    // A later request for the same coding is served from memory, another
    // coding is encoded once more, and identity needs neither.
    await cache.serve(get("chunk-js1.js"), "chunk-js1.js");
    await cache.serve(get("chunk-js1.js", "zstd"), "chunk-js1.js");
    await cache.serve(get("chunk-js1.js", "identity"), "chunk-js1.js");
    expect(calls.bundle).toHaveLength(1);
    expect(encodes).toEqual(["gzip", "zstd"]);
  });

  test("a bare ETag is quoted, and weakened when encoded", async () => {
    const cache = new BundleCache(fakeSource().source);
    cache.rewriteHtml(page);
    expect((await cache.serve(get("chunk-js1.js"), "chunk-js1.js")).headers.get("etag")).toBe('W/"bareToken"');
    expect((await cache.serve(get("chunk-js1.js", "identity"), "chunk-js1.js")).headers.get("etag")).toBe(
      '"bareToken"',
    );
  });

  for (const [label, upstream] of [
    ["a 404", () => new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } })],
    ["the SPA's HTML", () => new Response(page, { headers: { "Content-Type": "text/html;charset=utf-8" } })],
    ["a 500", () => new Response("boom", { status: 500, headers: { "Content-Type": "text/javascript" } })],
  ] as const) {
    test(`${label} from upstream is a 404 and is not kept`, async () => {
      let answer: () => Response = upstream;
      const { source, calls } = fakeSource({ bundle: async () => answer() });
      const cache = new BundleCache(source);
      cache.rewriteHtml(page);

      const res = await cache.serve(get("chunk-js1.js"), "chunk-js1.js");
      expect(res.status).toBe(404);
      expect(await waitForSize(cache, 0)).toBe(true);

      answer = () => bundleResponse();
      const retried = await cache.serve(get("chunk-js1.js"), "chunk-js1.js");
      expect(retried.status).toBe(200);
      expect(Bun.gunzipSync(new Uint8Array(await retried.arrayBuffer()))).toEqual(js);
      expect(calls.bundle).toHaveLength(2);
    });
  }

  test("a fetch that throws is a 404 and is retried", async () => {
    let fail = true;
    const { source, calls } = fakeSource({
      bundle: async () => {
        if (fail) throw new Error("connection refused");
        return bundleResponse();
      },
    });
    const cache = new BundleCache(source);
    cache.rewriteHtml(page);
    expect((await cache.serve(get("chunk-js1.js"), "chunk-js1.js")).status).toBe(404);
    expect(await waitForSize(cache, 0)).toBe(true);
    fail = false;
    expect((await cache.serve(get("chunk-js1.js"), "chunk-js1.js")).status).toBe(200);
    expect(calls.bundle).toHaveLength(2);
  });

  test("an encoder that fails sends identity, and is tried again next time", async () => {
    let fail = true;
    const encodes: Encoding[] = [];
    const cache = new BundleCache(fakeSource().source, (encoding, body) => {
      encodes.push(encoding);
      if (fail) throw new Error("encoder broke");
      return encode(encoding, body);
    });
    cache.rewriteHtml(page);

    const first = await cache.serve(get("chunk-js1.js"), "chunk-js1.js");
    expect(first.headers.get("content-encoding")).toBeNull();
    expect(first.headers.get("vary")).toBe("Accept-Encoding");
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(js);

    fail = false;
    const second = await cache.serve(get("chunk-js1.js"), "chunk-js1.js");
    expect(second.headers.get("content-encoding")).toBe("gzip");
    expect(encodes).toEqual(["gzip", "gzip"]);
  });

  test("names that are not a hashed chunk never reach the source", async () => {
    const { source, calls } = fakeSource();
    const cache = new BundleCache(source);
    cache.rewriteHtml(page);
    for (const name of ["../api/ping", "chunk-js1.js?x=1", "CHUNK-JS1.JS", "chunk-js1.map", "index.html", ""]) {
      expect((await cache.serve(get(name), name)).status).toBe(404);
    }
    expect(calls.bundle).toEqual([]);
  });

  test("before any page is served, one read of the HTML teaches the names", async () => {
    const gate = deferred<Response>();
    const { source, calls } = fakeSource({ html: () => gate.promise });
    const cache = new BundleCache(source);

    const pending = [
      cache.serve(get("chunk-js1.js"), "chunk-js1.js"),
      cache.serve(get("chunk-css1.css"), "chunk-css1.css"),
      cache.serve(get("chunk-stale.js"), "chunk-stale.js"),
    ];
    gate.resolve(new Response(page, { headers: { "Content-Type": "text/html;charset=utf-8" } }));
    const [jsRes, cssRes, stale] = await Promise.all(pending);

    expect(calls.html).toBe(1);
    expect(jsRes!.status).toBe(200);
    expect(cssRes!.status).toBe(200);
    expect(stale!.status).toBe(404);
    expect(calls.bundle.sort()).toEqual(["chunk-css1.css", "chunk-js1.js"]);
  });

  test("an error page does not teach the names; the next request reads the HTML again", async () => {
    let healthy = false;
    const { source, calls } = fakeSource({
      html: async () =>
        healthy
          ? new Response(page, { headers: { "Content-Type": "text/html" } })
          : new Response("down", { status: 503, headers: { "Content-Type": "text/html" } }),
    });
    const cache = new BundleCache(source);
    expect((await cache.serve(get("chunk-js1.js"), "chunk-js1.js")).status).toBe(404);
    healthy = true;
    expect((await cache.serve(get("chunk-js1.js"), "chunk-js1.js")).status).toBe(200);
    expect(calls.html).toBe(2);
  });

  test("a source that throws while reading the HTML is retried, not given up on", async () => {
    let calls = 0;
    const cache = new BundleCache({
      fetchBundle: async () => bundleResponse(),
      fetchHtml: () => {
        calls++;
        if (calls === 1) throw new Error("no listener yet");
        return Promise.resolve(new Response(page, { headers: { "Content-Type": "text/html" } }));
      },
    });
    expect((await cache.serve(get("chunk-js1.js"), "chunk-js1.js")).status).toBe(404);
    expect((await cache.serve(get("chunk-js1.js"), "chunk-js1.js")).status).toBe(200);
    expect(calls).toBe(2);
  });

  test("a new page replaces the names and drops what it no longer names", async () => {
    const { source } = fakeSource();
    const cache = new BundleCache(source);
    cache.rewriteHtml(page);
    await cache.serve(get("chunk-js1.js"), "chunk-js1.js");
    await cache.serve(get("chunk-css1.css"), "chunk-css1.css");
    expect(cache.size).toBe(2);

    cache.rewriteHtml(`<script src="/chunk-js2.js"></script><link href="/chunk-css1.css">`);
    expect(cache.size).toBe(1);
    expect((await cache.serve(get("chunk-js1.js"), "chunk-js1.js")).status).toBe(404);
    expect((await cache.serve(get("chunk-js2.js"), "chunk-js2.js")).status).toBe(200);
  });

  test("HEAD carries the GET's headers and length, and no body", async () => {
    const cache = new BundleCache(fakeSource().source);
    cache.rewriteHtml(page);
    const getRes = await cache.serve(get("chunk-js1.js"), "chunk-js1.js");
    const encodedLength = (await getRes.arrayBuffer()).byteLength;
    const head = await cache.serve(get("chunk-js1.js", "gzip", "HEAD"), "chunk-js1.js");
    expect(head.body).toBeNull();
    expect(head.headers.get("content-encoding")).toBe("gzip");
    expect(Number(head.headers.get("content-length"))).toBe(encodedLength);
  });
});

/** Eviction of a failed entry runs a tick after the response it failed. */
function waitForSize(cache: BundleCache, size: number): Promise<boolean> {
  return waitFor(() => cache.size === size, 1000);
}
