import { test, expect, describe, beforeAll, afterAll, afterEach } from "bun:test";
import { connect } from "node:net";
import { brotliDecompressSync } from "node:zlib";
import type { Server } from "bun";
import { COMPRESS_THRESHOLD, compressRoute, compressRoutes, negotiateEncoding } from "./compress";
import { guardApiRoutes, resetOriginGuard } from "./origin";
import { serveSpa } from "./spa";

// Response compression (TASK-147), through a real Bun.serve mounting the same
// wrappers `server.ts` does: `compressRoutes(guardApiRoutes(...))`.

const big = {
  rows: Array.from({ length: 400 }, (_, i) => ({ path: `src/lib/file-${i}.ts`, status: "modified", additions: i })),
};
const bigJson = JSON.stringify(big);
const bigHtml = `<!doctype html><html><head><title>t</title></head><body>${"<div class=\"row\">hello</div>".repeat(200)}</body></html>`;
// Bytes that would compress to almost nothing, so passing through untouched
// is the image rule and not the encoder giving up.
const png = new Uint8Array(4096);
png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A stream that sends one chunk and then waits to be let go. A route that
 * buffered it would send nothing until `release()`. */
function gatedStream() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${"x".repeat(2000)}\n\n`));
      await gate;
      controller.enqueue(new TextEncoder().encode("data: done\n\n"));
      controller.close();
    },
  });
  return { body, release };
}
const gates: (() => void)[] = [];

let server: Server<undefined>;
let base: string;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    routes: {
      ...compressRoutes(
        guardApiRoutes({
          "/api/big": { GET: () => Response.json(big) },
          "/api/small": { GET: () => Response.json({ ok: true }) },
          "/api/small-error": { GET: () => Response.json({ error: "Unknown task" }, { status: 404 }) },
          "/api/big-error": {
            GET: () => Response.json({ error: "boom", detail: bigJson }, { status: 500 }),
          },
          "/api/image": {
            GET: () => new Response(png, { headers: { "Content-Type": "image/png", "Cache-Control": "no-cache" } }),
          },
          "/api/encoded": {
            GET: () =>
              new Response(Bun.gzipSync(new TextEncoder().encode(bigJson)), {
                headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" },
              }),
          },
          "/api/tagged": {
            GET: () =>
              new Response(bigJson, {
                headers: { "Content-Type": "application/json", ETag: '"abc"', Vary: "Origin" },
              }),
          },
          "/api/events": {
            GET: () => {
              const { body, release } = gatedStream();
              gates.push(release);
              return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
            },
          },
          "/api/no-transform": {
            GET: () => {
              const { body, release } = gatedStream();
              gates.push(release);
              return new Response(body, {
                headers: { "Content-Type": "application/json", "Cache-Control": "no-cache, no-transform" },
              });
            },
          },
          // A bare function, the other shape a table may hold.
          "/api/bare": () => Response.json(big),
          "/api/posted": { POST: async (req: Request) => Response.json({ echo: await req.text() }) },
        }),
      ),
      "/api/single": compressRoute({ GET: () => Response.json(big) }),
      "/spa": { GET: (req: Request) => serveSpa(req, htmlUpstream(bigHtml)) },
      "/spa-small": { GET: (req: Request) => serveSpa(req, htmlUpstream("<!doctype html><p>hi</p>")) },
    },
    fetch: () => new Response("", { status: 404 }),
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => server.stop(true));
afterEach(() => {
  for (const release of gates) release();
  gates.length = 0;
  resetOriginGuard();
});

/** What Bun's HTML import answers on the hidden route, as `fetch` hands it to
 * the catch-all: a strong ETag and a Content-Length for the identity body. */
function htmlUpstream(html: string): Response {
  return new Response(html, {
    headers: {
      "Content-Type": "text/html;charset=utf-8",
      ETag: '"bf212de13f36bea9"',
      "Content-Length": String(new TextEncoder().encode(html).byteLength),
    },
  });
}

/** The bytes as sent: `decompress: false` stops fetch undoing the encoding. */
async function raw(path: string, acceptEncoding: string, init: RequestInit = {}) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    decompress: false,
    headers: { "Accept-Encoding": acceptEncoding, ...(init.headers as Record<string, string>) },
  });
  return { res, bytes: new Uint8Array(await res.arrayBuffer()) };
}

/** A request with no Accept-Encoding at all. Bun's fetch adds one of its own
 * when the caller sends none, so "absent" has to be written by hand. */
async function rawWithoutAcceptEncoding(path: string): Promise<{ head: string; body: string }> {
  const sock = connect(server.port!, "127.0.0.1");
  const chunks: Buffer[] = [];
  sock.on("data", (c: Buffer) => chunks.push(c));
  await new Promise<void>((resolve) => sock.once("connect", () => resolve()));
  sock.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${server.port}\r\nConnection: close\r\n\r\n`);
  await new Promise<void>((resolve) => sock.once("close", () => resolve()));
  const text = Buffer.concat(chunks).toString();
  const end = text.indexOf("\r\n\r\n");
  return { head: text.slice(0, end), body: text.slice(end + 4) };
}

const decoders: Record<string, (b: Uint8Array<ArrayBuffer>) => Uint8Array> = {
  gzip: (b) => Bun.gunzipSync(b),
  br: (b) => brotliDecompressSync(b),
  zstd: (b) => Bun.zstdDecompressSync(b),
};

describe("negotiateEncoding", () => {
  test("absent, empty or identity-only asks for nothing", () => {
    expect(negotiateEncoding(null)).toBeNull();
    expect(negotiateEncoding("")).toBeNull();
    expect(negotiateEncoding("identity")).toBeNull();
  });

  test("a browser's list picks the best coding we have", () => {
    expect(negotiateEncoding("gzip, deflate, br, zstd")).toBe("br");
    expect(negotiateEncoding("gzip, zstd")).toBe("zstd");
    // What a browser sends to a plain-http origin: gzip is the one that matters.
    expect(negotiateEncoding("gzip, deflate")).toBe("gzip");
    expect(negotiateEncoding("x-gzip")).toBe("gzip");
  });

  test("q-values order the choice and q=0 refuses", () => {
    expect(negotiateEncoding("br;q=0.5, gzip")).toBe("gzip");
    expect(negotiateEncoding("gzip;q=0, br;q=0.1")).toBe("br");
    expect(negotiateEncoding("gzip;q=0")).toBeNull();
    expect(negotiateEncoding("GZIP;Q=0.8")).toBe("gzip");
  });

  test("a wildcard allows what is not named, and *;q=0 refuses everything", () => {
    expect(negotiateEncoding("*")).toBe("br");
    expect(negotiateEncoding("*;q=0")).toBeNull();
    expect(negotiateEncoding("identity, *;q=0")).toBeNull();
    // Named beats wildcarded at the same weight; a named refusal holds.
    expect(negotiateEncoding("gzip, *")).toBe("gzip");
    expect(negotiateEncoding("br;q=0, *")).toBe("zstd");
  });

  test("an unreadable weight is a refusal, never a guess", () => {
    expect(negotiateEncoding("gzip;q=lots")).toBeNull();
  });
});

describe("compressed API responses", () => {
  for (const encoding of ["gzip", "br", "zstd"]) {
    test(`${encoding}: decodes to the same body, with Content-Encoding and Vary`, async () => {
      const { res, bytes } = await raw("/api/big", encoding);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-encoding")).toBe(encoding);
      expect(res.headers.get("vary")).toBe("Accept-Encoding");
      expect(res.headers.get("content-type")).toMatch(/^application\/json/);
      // The length on the wire is the encoded one, not the stale identity one.
      expect(Number(res.headers.get("content-length"))).toBe(bytes.byteLength);
      expect(bytes.byteLength).toBeLessThan(bigJson.length / 3);
      expect(new TextDecoder().decode(decoders[encoding]!(bytes))).toBe(bigJson);
    });
  }

  test("a browser's own fetch decodes it transparently", async () => {
    const res = await fetch(`${base}/api/big`, { headers: { "Accept-Encoding": "gzip, deflate" } });
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(await res.json()).toEqual(big);
  });

  test("Accept-Encoding absent: uncompressed, but still Vary", async () => {
    const { head, body } = await rawWithoutAcceptEncoding("/api/big");
    expect(head).toMatch(/^HTTP\/1\.1 200/);
    expect(head).not.toMatch(/content-encoding/i);
    expect(head).toMatch(/^vary: Accept-Encoding$/im);
    expect(body).toBe(bigJson);
  });

  test("identity, or every coding refused: uncompressed", async () => {
    for (const header of ["identity", "*;q=0", "gzip;q=0", "deflate"]) {
      const { res, bytes } = await raw("/api/big", header);
      expect(res.headers.get("content-encoding")).toBeNull();
      expect(res.headers.get("vary")).toBe("Accept-Encoding");
      expect(new TextDecoder().decode(bytes)).toBe(bigJson);
    }
  });

  test("every shape of route table is covered", async () => {
    for (const path of ["/api/bare", "/api/single"]) {
      const { res, bytes } = await raw(path, "gzip");
      expect(res.headers.get("content-encoding")).toBe("gzip");
      expect(new TextDecoder().decode(Bun.gunzipSync(bytes))).toBe(bigJson);
    }
  });

  test("an error above the threshold is compressed like any other answer", async () => {
    const { res, bytes } = await raw("/api/big-error", "gzip");
    expect(res.status).toBe(500);
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(JSON.parse(new TextDecoder().decode(Bun.gunzipSync(bytes))).error).toBe("boom");
  });

  test("an existing Vary is kept and a strong ETag is weakened", async () => {
    const { res } = await raw("/api/tagged", "gzip");
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(res.headers.get("vary")).toBe("Origin, Accept-Encoding");
    expect(res.headers.get("etag")).toBe('W/"abc"');
  });

  test("a POST's answer is compressed too", async () => {
    const payload = "y".repeat(COMPRESS_THRESHOLD * 2);
    const { res, bytes } = await raw("/api/posted", "gzip", { method: "POST", body: payload });
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(JSON.parse(new TextDecoder().decode(Bun.gunzipSync(bytes))).echo).toBe(payload);
  });
});

describe("responses sent as they are", () => {
  test("a small response passes through untouched", async () => {
    const { res, bytes } = await raw("/api/small", "gzip, br, zstd");
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(res.headers.get("vary")).toBeNull();
    expect(new TextDecoder().decode(bytes)).toBe('{"ok":true}');
  });

  test("a small error passes through untouched", async () => {
    const { res, bytes } = await raw("/api/small-error", "gzip");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual({ error: "Unknown task" });
  });

  test("an image is not recompressed", async () => {
    const { res, bytes } = await raw("/api/image", "gzip, br, zstd");
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(bytes).toEqual(png);
  });

  test("a body that is already encoded keeps its encoding", async () => {
    const { res, bytes } = await raw("/api/encoded", "gzip, br, zstd");
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(new TextDecoder().decode(Bun.gunzipSync(bytes))).toBe(bigJson);
  });

  test("HEAD gets no encoding and no body", async () => {
    const { res, bytes } = await raw("/api/big", "gzip", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(bytes.byteLength).toBe(0);
  });

  test("a cross-origin refusal is still the guard's, and still small", async () => {
    const { res, bytes } = await raw("/api/big", "gzip", { headers: { Origin: "http://evil.test" } });
    expect(res.status).toBe(403);
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(JSON.parse(new TextDecoder().decode(bytes)).error).toMatch(/Cross-origin/);
  });

  for (const path of ["/api/events", "/api/no-transform"]) {
    test(`${path} still streams: the first chunk arrives before the stream ends`, async () => {
      const res = await fetch(`${base}${path}`, { decompress: false, headers: { "Accept-Encoding": "gzip" } });
      expect(res.headers.get("content-encoding")).toBeNull();
      const reader = res.body!.getReader();
      // Read while the gate is still shut: a buffering wrapper would hold this
      // until the stream closed, which it cannot do until the gate opens.
      const first = await reader.read();
      expect(first.done).toBe(false);
      expect(new TextDecoder().decode(first.value)).toStartWith("data: xxx");
      gates.forEach((release) => release());
      let rest = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        rest += new TextDecoder().decode(value);
      }
      expect(rest).toContain("data: done");
    });
  }
});

describe("the SPA's HTML", () => {
  test("is compressed and keeps Cache-Control, X-Frame-Options and CSP", async () => {
    const { res, bytes } = await raw("/spa", "gzip");
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(res.headers.get("vary")).toBe("Accept-Encoding");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
    expect(res.headers.get("etag")).toBe('W/"bf212de13f36bea9"');
    // The upstream's identity Content-Length did not survive onto the encoded body.
    expect(Number(res.headers.get("content-length"))).toBe(bytes.byteLength);
    expect(new TextDecoder().decode(Bun.gunzipSync(bytes))).toBe(bigHtml);
  });

  test("below the threshold it goes out plain, headers intact", async () => {
    const { res, bytes } = await raw("/spa-small", "gzip");
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("etag")).toBe('"bf212de13f36bea9"');
    expect(new TextDecoder().decode(bytes)).toBe("<!doctype html><p>hi</p>");
  });
});
