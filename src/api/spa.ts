import type { HTMLBundle } from "bun";
import { BUNDLE_PREFIX, BundleCache } from "./bundles";
import { compressResponse } from "./compress";

/** The SPA's HTML as the catch-all route serves it, built from what Bun's
 * HTML import answered on the hidden route.
 *
 * Given `bundles` (production only), the page's JS and CSS references are
 * pointed at the route that serves them compressed, and the cache learns which
 * names those are (TASK-150).
 *
 * Out of `server.ts` so a test can drive it: that file imports the frontend's
 * HTML entry point, and importing it bundles the whole app. */
export async function serveSpa(req: Request, upstream: Response, bundles?: BundleCache): Promise<Response> {
  const headers = new Headers(upstream.headers);
  // The body below is what `fetch` decoded, whatever the hidden route sent, so
  // an encoding or length copied from its headers would describe other bytes.
  // Dropped, and recomputed by `compressResponse` and Bun respectively.
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.set("Cache-Control", "no-cache");
  // This route is deliberately unguarded — a top-level navigation to
  // the SPA carries no Origin, and serving HTML is not a mutation. But
  // an unguarded page that can be framed hands an attacker the whole
  // UI: every request the framed SPA makes is genuinely same-origin, so
  // origin.ts waves it through, and a transparent overlay drives the
  // routes that spawn agents in the user's repositories without ever
  // making a cross-origin request. Both headers, since the CSP form is
  // the current one and X-Frame-Options is what older browsers read.
  headers.set("X-Frame-Options", "DENY");
  headers.set("Content-Security-Policy", "frame-ancestors 'none'");

  let body: BodyInit | null = upstream.body;
  // Only a page is rewritten, and only a page teaches the cache its names.
  if (bundles && upstream.ok && /^text\/html/i.test(headers.get("content-type") ?? "")) {
    body = bundles.rewriteHtml(await upstream.text());
    // Bun's tag is for the unrewritten page, which a daemon without the
    // rewrite serves under the same build. A distinct tag keeps a revalidation
    // from ever matching one page against the other.
    const etag = headers.get("etag");
    const quoted = etag?.match(/^(W\/)?"(.*)"$/);
    if (quoted) headers.set("ETag", `${quoted[1] ?? ""}"${quoted[2]}-bundled"`);
    else headers.delete("etag");
  }
  // Under the API's rule (TASK-147). Read whole, which is safe here: the body
  // is our own index.html, not a stream of anyone's making.
  return compressResponse(
    req,
    new Response(body, { status: upstream.status, statusText: upstream.statusText, headers }),
  );
}

// Asset extensions that should never be served as HTML.
// If a browser requests one of these and it doesn't match a real static file,
// it's a stale cached reference — return 404 instead of the SPA.
const assetExtRe = /\.(js|css|mjs|woff2?|ttf|otf|eot|map|png|jpe?g|gif|svg|ico|webp|avif)$/;

export interface SpaRouteOptions {
  /** The frontend's HTML import. */
  index: HTMLBundle;
  /** The hidden path it is mounted on. */
  spaPath: string;
  /** Where this daemon's own listener answers. Read per request, since a
   * `--port 0` daemon has no port until `serve()` returns. */
  selfOrigin: () => string;
  /** Rewrite the page to serve its bundles compressed. Off in development,
   * where Bun's dev server names its assets under `/_bun/` and changes their
   * hashes on every edit, which a cache keyed by name would hoard. */
  production: boolean;
}

/** A route this table holds. The request is `any` the way Bun's own handler
 * types take it, so the table spreads into a `serve()` of any socket data. */
type SpaRoute = HTMLBundle | { GET(req: any): Promise<Response>; HEAD?(req: any): Promise<Response> };

/** The SPA's routes: the HTML import on its hidden path, the catch-all that
 * serves its page, and (in production) the compressed bundles.
 *
 * None of them is behind `guardApiRoutes`: a top-level navigation carries no
 * Origin, and neither does a `<script>` or stylesheet load the page makes. */
export function spaRoutes({ index, spaPath, selfOrigin, production }: SpaRouteOptions): Record<string, SpaRoute> {
  // The hidden route and the bundles' own routes, reached through the
  // listener and never through the Host header (see the catch-all below).
  // `identity`, because what comes back is compressed for the browser on the
  // way out and a loopback hop gains nothing from it.
  const upstream = (path: string) =>
    fetch(new URL(path, selfOrigin()), { headers: { "Accept-Encoding": "identity" } });
  const bundles = production
    ? new BundleCache({
        fetchHtml: () => upstream(spaPath),
        // The name has passed BUNDLE_NAME_RE and is one the page named, so it
        // is a single path segment and cannot reach anything but a bundle.
        fetchBundle: (name) => upstream(`/${name}`),
      })
    : undefined;

  // Mounted in development too, answering 404 there as the catch-all would
  // for a `.js` path, so the table has one shape.
  type BundleRequest = Request & { params: { name: string } };
  const serveBundle = async (req: BundleRequest) =>
    bundles ? bundles.serve(req, req.params.name) : new Response("Not found", { status: 404 });

  return {
    // Mount the SPA on a hidden UUID path so Bun handles bundling/hashing.
    // The wildcard route below proxies to it with proper cache headers.
    [spaPath]: index,

    "/*": {
      async GET(req: Request) {
        const url = new URL(req.url);
        // Stale asset request from an old cached index.html — return 404
        if (assetExtRe.test(url.pathname)) {
          return new Response("Not found", { status: 404 });
        }
        // The Host header is not a place to look up our own address. Bun
        // builds `req.url` from it, so `new URL(spaPath, url.origin)` sent
        // the daemon to fetch whatever host the caller named and then served
        // that body as its own HTML: `curl -H "Host: attacker.example" /`
        // returned the attacker's page from this origin, which is both a
        // request the daemon made on someone else's behalf and a way to run
        // their script inside our origin. Addressed to the listener instead,
        // which is the one thing we actually know.
        return serveSpa(req, await upstream(spaPath), bundles);
      },
    },

    [`${BUNDLE_PREFIX}:name`]: { GET: serveBundle, HEAD: serveBundle },
  };
}
