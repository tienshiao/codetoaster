// Response compression for the API and the SPA's HTML (TASK-147).
//
// Bun.serve compresses nothing on its own. On localhost that costs nothing,
// but over a remote link every diff, file read and git log page went out raw,
// and they are exactly the repetitive text that shrinks several times over.
//
// One function, `compressResponse`, decides for one response; `compressRoutes`
// applies it to a route table the way `guardApiRoutes` applies the origin
// check, so a route added to the table is compressed by construction. The
// frontend bundles reuse its negotiation and encoders (bundles.ts, TASK-150).

import { promisify } from "node:util";
import { brotliCompress, constants as zlibConstants, gzip } from "node:zlib";

export type Encoding = "zstd" | "br" | "gzip";

/** What we can produce, best first. Used to break ties between codings the
 * client weighted equally. Every one of them has an asynchronous encoder that
 * runs off the event loop, which matters: the loop that would otherwise spend
 * 40ms deflating a large diff is the one pumping every terminal's output.
 *
 * Smallest first, because the link is the cost being paid: measured on a
 * 1.25 MB file read, br 124 KB, zstd 154 KB, gzip 187 KB, and on a 177 KB
 * diff br 40 KB, gzip 43 KB, zstd 45 KB. A browser only offers br and zstd
 * over HTTPS, so a daemon reached over plain http answers with gzip. */
const PREFERENCE: readonly Encoding[] = ["br", "zstd", "gzip"];

/** Below this a response goes out as it is. A compressed body carries framing
 * of its own (gzip's header and trailer alone are 18 bytes), and the small
 * answers — a 404, `{ok: true}`, a task row — gain nothing worth the work. */
export const COMPRESS_THRESHOLD = 1024;

/** Pick the coding to answer `Accept-Encoding` with, or null for none.
 *
 * Absent means uncompressed. RFC 9110 reads a missing header as "anything",
 * but nothing that sends none is a browser, and a curl without `--compressed`
 * expects plain bytes back. (The CLI's Bun `fetch` offers br, gzip and zstd by
 * default and decodes them itself, so it is compressed like a browser.)
 *
 * A coding named with `q=0` is refused, and `*` stands for every coding not
 * named — so `*;q=0` refuses them all and `identity` alone asks for none. On
 * equal weights a coding the client named beats one it only allowed through
 * `*`, and then PREFERENCE decides. */
export function negotiateEncoding(header: string | null): Encoding | null {
  if (!header) return null;
  const weights = new Map<string, number>();
  for (const part of header.split(",")) {
    const [rawName, ...params] = part.split(";");
    const name = rawName!.trim().toLowerCase();
    if (!name) continue;
    let q = 1;
    for (const param of params) {
      const [key, value] = param.split("=");
      if (key?.trim().toLowerCase() !== "q") continue;
      const parsed = Number(value?.trim());
      // An unreadable weight is not a preference anyone expressed; treating it
      // as a refusal is the reading that can never send bytes a client
      // cannot decode.
      q = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 1) : 0;
    }
    // `x-gzip` is gzip's old name, and still the same decoder.
    const key = name === "x-gzip" ? "gzip" : name;
    if (!weights.has(key)) weights.set(key, q);
  }
  const star = weights.get("*");
  let best: { encoding: Encoding; q: number; named: boolean } | null = null;
  for (const encoding of PREFERENCE) {
    const weight = weights.get(encoding);
    const q = weight ?? star ?? 0;
    if (q <= 0) continue;
    const named = weight !== undefined;
    // Weight first, then "named rather than wildcarded"; PREFERENCE order is
    // what is left, which only replacing on a strict win gives for free.
    if (!best || q > best.q || (q === best.q && named && !best.named)) {
      best = { encoding, q, named };
    }
  }
  return best?.encoding ?? null;
}

/** Whether a body of this type is text worth compressing.
 *
 * An allowlist, because the alternative is compressing what is already
 * compressed: the image routes answer PNGs and JPEGs, and an unknown type is
 * more likely binary than not. Every `image/*` is left alone, SVG included —
 * it is text, but it is also the one image type the image routes serve that a
 * user would not notice either way, and "images are sent as they are" is the
 * simpler rule to hold.
 *
 * `text/event-stream` is the exception among text: it is a stream that must
 * reach the client as it is written, and compressing it means buffering it.
 * NDJSON is left off the list for the same reason: it is the other format a
 * route would stream in. */
export function isCompressibleType(contentType: string | null): boolean {
  if (!contentType) return false;
  const type = contentType.split(";")[0]!.trim().toLowerCase();
  if (type.startsWith("image/")) return false;
  if (type === "text/event-stream") return false;
  return (
    type.startsWith("text/") ||
    type === "application/json" ||
    type.endsWith("+json") ||
    type === "application/javascript" ||
    type === "application/xml" ||
    type.endsWith("+xml")
  );
}

/** Whether this response is one compression may touch at all, before anything
 * about its size is known. */
function eligible(req: Request, res: Response): boolean {
  // No body to send, so nothing to encode — and a HEAD that claimed an
  // encoding its GET might not use would describe a different response.
  if (req.method === "HEAD") return false;
  if (res.body === null) return false;
  if (res.status < 200 || res.status === 204 || res.status === 304) return false;
  // A range is a slice of the identity body; compressing it would make the
  // offsets mean nothing.
  if (res.status === 206 || res.headers.has("content-range")) return false;
  // Already encoded by whoever built it.
  if (res.headers.has("content-encoding")) return false;
  // The standard way to say "pass this through untouched", and the opt-out for
  // a route that streams: a body read here is read to its end before the first
  // byte goes out, so a stream that must arrive as it is written sets this.
  if (/(?:^|,)\s*no-transform\s*(?:,|$)/i.test(res.headers.get("cache-control") ?? "")) return false;
  return isCompressibleType(res.headers.get("content-type"));
}

/** `Vary: Accept-Encoding`, added to whatever Vary already says. */
export function appendVary(headers: Headers): void {
  const existing = headers.get("vary");
  if (!existing) {
    headers.set("Vary", "Accept-Encoding");
    return;
  }
  const tokens = existing.split(",").map((t) => t.trim().toLowerCase());
  if (tokens.includes("*") || tokens.includes("accept-encoding")) return;
  headers.set("Vary", `${existing}, Accept-Encoding`);
}

const gzipAsync = promisify(gzip);
const brotliAsync = promisify(brotliCompress);

/** Encode a whole body. Levels chosen for a daemon answering interactively
 * rather than a CDN encoding once: zstd 3 and gzip 6 are their libraries'
 * defaults, and brotli's default of 11 is tens of times slower than 5 for a
 * few percent. */
export async function encode(encoding: Encoding, body: Uint8Array): Promise<Uint8Array> {
  switch (encoding) {
    case "zstd":
      return Bun.zstdCompress(body, { level: 3 });
    case "br":
      return brotliAsync(body, {
        params: {
          [zlibConstants.BROTLI_PARAM_QUALITY]: 5,
          [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
          [zlibConstants.BROTLI_PARAM_SIZE_HINT]: body.byteLength,
        },
      });
    case "gzip":
      return gzipAsync(body, { level: 6 });
  }
}

/** A response rebuilt around a body already read out of it. */
function rebuilt(res: Response, body: Uint8Array, headers: Headers): Response {
  // Content-Length belongs to whatever body the header was written for. Bun
  // writes the right one for a buffered body, so the stale one goes.
  headers.delete("content-length");
  // The cast is for zlib's Buffers, typed over ArrayBufferLike; none of these
  // bodies is backed by a SharedArrayBuffer.
  return new Response(body as Uint8Array<ArrayBuffer>, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

/** Compress `res` for `req` when the rules allow it, otherwise return it as
 * it is (or, once its body has been read, an identical copy).
 *
 * A body that qualifies is read whole. That is a deliberate limit and not an
 * oversight: Bun gives every Response a `ReadableStream` body and no
 * Content-Length, so there is no telling a buffered JSON answer from a live
 * stream by looking. Every route compressed today builds its body in memory;
 * one that streams must say so with `Cache-Control: no-transform` or an
 * `text/event-stream` type, and is passed through untouched. */
export async function compressResponse(req: Request, res: Response): Promise<Response> {
  if (!eligible(req, res)) return res;
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > 0 && declared < COMPRESS_THRESHOLD) return res;

  const body = new Uint8Array(await res.arrayBuffer());
  const headers = new Headers(res.headers);
  // Small: as it was, Vary and all. Whether it is compressed does not depend
  // on Accept-Encoding, so there is nothing for a cache to vary on.
  if (body.byteLength < COMPRESS_THRESHOLD) return rebuilt(res, body, headers);

  // From here the answer depends on Accept-Encoding whichever way it goes, and
  // a cache has to know that even when this one goes out plain.
  appendVary(headers);
  const encoding = negotiateEncoding(req.headers.get("accept-encoding"));
  if (!encoding) return rebuilt(res, body, headers);

  let encoded: Uint8Array;
  try {
    encoded = await encode(encoding, body);
  } catch (error) {
    // An encoder failing is not a reason to fail the request it was asked to
    // make smaller.
    console.warn(`Could not ${encoding}-encode a response:`, error);
    return rebuilt(res, body, headers);
  }
  // Incompressible after all (already-compressed bytes behind a text type).
  if (encoded.byteLength >= body.byteLength) return rebuilt(res, body, headers);

  headers.set("Content-Encoding", encoding);
  // A strong ETag promises byte-identical bodies, and the encoded one is not
  // the identity one. Weak still lets a revalidation match.
  const etag = headers.get("etag");
  if (etag && !etag.startsWith("W/")) headers.set("ETag", `W/${etag}`);
  return rebuilt(res, encoded, headers);
}

type Handler = (req: any, ...rest: any[]) => Response | Promise<Response>;

function compressHandler(handler: Handler): Handler {
  return async (req: Request, ...rest: unknown[]) => {
    const res = await handler(req, ...rest);
    return res instanceof Response ? compressResponse(req, res) : res;
  };
}

/** Wraps one route's methods with `compressResponse`. */
export function compressRoute<T extends Record<string, unknown>>(handlers: T): T {
  const wrapped: Record<string, unknown> = {};
  for (const [method, handler] of Object.entries(handlers)) {
    wrapped[method] = typeof handler === "function" ? compressHandler(handler as Handler) : handler;
  }
  return wrapped as T;
}

/** Wraps every handler in a route table with `compressResponse`.
 *
 * The same shapes `guardApiRoutes` walks: a table of methods, a bare function
 * answering every method, or a static value Bun serves itself (passed through,
 * since there is no handler to wrap). Applied *outside* the guard, so the
 * origin check runs first and its refusals pass through here as the small
 * responses they are. */
export function compressRoutes<T extends Record<string, unknown>>(routes: T): T {
  const wrapped: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(routes)) {
    if (typeof value === "function") {
      wrapped[path] = compressHandler(value as Handler);
    } else if (!value || typeof value !== "object" || value instanceof Response) {
      wrapped[path] = value;
    } else {
      wrapped[path] = compressRoute(value as Record<string, unknown>);
    }
  }
  return wrapped as T;
}
