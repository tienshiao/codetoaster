// The frontend's JS and CSS bundles, compressed (TASK-150).
//
// Bun's HTML import serves `/chunk-<hash>.js` and `/chunk-<hash>.css` from
// static routes of its own and compresses neither, and a route of ours cannot
// take those paths over: one declared at `serve()` loses to the bundle's, and
// one added by `server.reload` wins only until the next request to the HTML
// route registers the bundle's routes again — which every navigation makes.
//
// So the SPA's HTML is rewritten instead. `serveSpa` points each bundle at
// `/_bundle/<same name>`, a route this module answers, and tells the cache
// which names the page refers to. Only those names are served: each is fetched
// once from Bun's own route, encoded once per coding a browser asks for, and
// kept for the life of the process. Bun's original paths keep answering, plain,
// for anything that still asks for them.
//
// Nothing inside the bundles needs rewriting. The production build is one JS
// and one CSS file with no code splitting, and the CSS names its fonts by
// absolute path (`url(/Name-hash.woff2)`), so they still resolve to Bun's
// routes from a stylesheet served under the prefix. Fonts stay there: woff2 is
// brotli inside already.

import {
  appendVary,
  COMPRESS_THRESHOLD,
  encode as defaultEncode,
  negotiateEncoding,
  type Encoding,
} from "./compress";

/** Where the rewritten HTML points the bundles. Not a path the SPA's router
 * uses, and not under `/api`. */
export const BUNDLE_PREFIX = "/_bundle/";

/** A bundle name this module will serve: Bun's chunk naming, a content hash
 * and nothing else. Restricting it to the hashed form is what makes the
 * year-long immutable caching below true by construction, and it keeps the
 * name from ever carrying a `/`, a `..` or a query into the upstream URL. */
const BUNDLE_NAME_RE = /^chunk-[a-z0-9]+\.(?:js|css)$/;

/** A root-relative `src` or `href` naming a bundle, as Bun writes them into
 * the page. A page whose references take another shape is left alone, and its
 * bundles go out the way they did before. */
const HTML_REF_RE = /(\s(?:src|href)=)(["'])\/(chunk-[a-z0-9]+\.(?:js|css))\2/g;

/** The names are content-hashed, so a name never changes meaning. Bun's
 * production route sends this; its compiled-binary route sends no
 * Cache-Control at all, and this route sends it either way. */
const IMMUTABLE = "public, max-age=31536000, immutable";

const BUNDLE_TYPE_RE = /^(?:text\/javascript|application\/javascript|text\/css)\s*(?:;|$)/i;

/** Where the bundles come from: Bun's own routes, reached through the
 * listener. Injected so the cache can be tested without bundling an app. */
export interface BundleSource {
  /** Bun's answer for `/<name>`. Only ever called with a name from the page. */
  fetchBundle(name: string): Promise<Response>;
  /** The SPA's HTML as Bun's HTML import answers it on the hidden route. */
  fetchHtml(): Promise<Response>;
}

interface Identity {
  body: Uint8Array;
  contentType: string;
  etag: string | null;
}

interface Entry {
  identity: Promise<Identity | null>;
  encoded: Map<Encoding, Promise<Uint8Array | null>>;
}

type Encoder = (encoding: Encoding, body: Uint8Array) => Promise<Uint8Array>;

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

/** An ETag in its quoted form. Bun's compiled binary sends a bare token, which
 * is not a valid entity tag and could not be weakened as one. */
function quotedEtag(etag: string | null): string | null {
  if (!etag) return null;
  if (etag.startsWith('"') || etag.startsWith('W/"')) return etag;
  return `"${etag.replaceAll('"', "")}"`;
}

/** Whether `If-None-Match` names this tag, by the weak comparison RFC 9110
 * prescribes for it: `W/` is ignored on both sides, since the tag sent with an
 * encoded body is the weakened identity tag. */
function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const opaque = (tag: string) => tag.trim().replace(/^W\//, "");
  const target = opaque(etag);
  return ifNoneMatch.split(",").some((tag) => tag.trim() === "*" || opaque(tag) === target);
}

/** The bundles the current page names, each fetched once and encoded once per
 * coding asked for.
 *
 * Lazily, not at startup. Bun builds the bundle on the first request to the
 * HTML route, so encoding at boot would mean forcing that build before anyone
 * has opened the page, and then encoding three codings when a browser only
 * ever asks for one. Measured on the 5 MB production JS, the first request for
 * a coding pays br 85ms, gzip 56ms or zstd 16ms once, which is small next to
 * the 3.8 MB it then saves on every first load over a remote link.
 *
 * Bounded by the page: the set of names is replaced, and dropped names
 * evicted, whenever the HTML is read. In production that set is fixed for the
 * life of the process, so the cache holds one JS and one CSS file, as identity
 * bytes plus each coding asked for. */
export class BundleCache {
  private known: Set<string> | null = null;
  private learning: Promise<void> | null = null;
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly source: BundleSource,
    private readonly encoder: Encoder = defaultEncode,
  ) {}

  /** Point the page's bundles at `BUNDLE_PREFIX`, and learn their names. */
  rewriteHtml(html: string): string {
    const names = new Set<string>();
    const rewritten = html.replace(HTML_REF_RE, (_match, attr: string, quote: string, name: string) => {
      names.add(name);
      return `${attr}${quote}${BUNDLE_PREFIX}${name}${quote}`;
    });
    this.learn(names);
    return rewritten;
  }

  /** How many bundles are held, for tests. */
  get size(): number {
    return this.entries.size;
  }

  private learn(names: Set<string>): void {
    this.known = names;
    for (const name of this.entries.keys()) {
      if (!names.has(name)) this.entries.delete(name);
    }
  }

  /** The set of names, read from the HTML when no page has been served yet —
   * which is the case for a browser that kept the page across a daemon
   * restart. One read however many requests are waiting for it. */
  private async knownNames(): Promise<Set<string>> {
    if (this.known) return this.known;
    if (!this.learning) {
      // Started a tick late, and cleared from the stored promise, so a source
      // that throws synchronously cannot clear `learning` before it is set and
      // leave a settled promise in place of a retry.
      const learning: Promise<void> = Promise.resolve()
        .then(() => this.source.fetchHtml())
        .then(async (res) => {
          // Only a page teaches the set. An error answer would teach it that
          // no bundle exists, and every request after would 404 until a page
          // was served.
          if (res.ok && /^text\/html/i.test(res.headers.get("content-type") ?? "")) {
            this.rewriteHtml(await res.text());
          }
        })
        .catch((error) => console.warn("Could not read the SPA's HTML for its bundle names:", error))
        .finally(() => {
          if (this.learning === learning) this.learning = null;
        });
      this.learning = learning;
    }
    await this.learning;
    return this.known ?? new Set();
  }

  private entry(name: string): Entry {
    const existing = this.entries.get(name);
    if (existing) return existing;
    const entry: Entry = { identity: this.load(name), encoded: new Map() };
    this.entries.set(name, entry);
    // A failure is not kept: the next request asks Bun again.
    void entry.identity.then((identity) => {
      if (!identity && this.entries.get(name) === entry) this.entries.delete(name);
    });
    return entry;
  }

  private async load(name: string): Promise<Identity | null> {
    try {
      const res = await this.source.fetchBundle(name);
      const contentType = res.headers.get("content-type") ?? "";
      // Only a bundle is kept. A 404, or the SPA's HTML from a fallback, is
      // not the asset and must never be served under its name for a year.
      if (res.status !== 200 || !BUNDLE_TYPE_RE.test(contentType)) {
        await res.body?.cancel();
        return null;
      }
      return {
        body: new Uint8Array(await res.arrayBuffer()),
        contentType,
        etag: quotedEtag(res.headers.get("etag")),
      };
    } catch (error) {
      console.warn(`Could not read bundle ${name}:`, error);
      return null;
    }
  }

  private encoded(name: string, entry: Entry, encoding: Encoding, body: Uint8Array): Promise<Uint8Array | null> {
    const existing = entry.encoded.get(encoding);
    if (existing) return existing;
    // Started a tick late so the promise is in the map before anything in it
    // can run, an encoder that throws synchronously included.
    const pending: Promise<Uint8Array | null> = Promise.resolve()
      .then(() => this.encoder(encoding, body))
      .then(
        // Not smaller: the identity body goes out, and that is what is kept.
        (out) => (out.byteLength < body.byteLength ? out : null),
        (error) => {
          console.warn(`Could not ${encoding}-encode bundle ${name}:`, error);
          // Not kept, so a later request tries again.
          if (entry.encoded.get(encoding) === pending) entry.encoded.delete(encoding);
          return null;
        },
      );
    entry.encoded.set(encoding, pending);
    return pending;
  }

  /** Answer a GET or HEAD for `/_bundle/<name>`. */
  async serve(req: Request, name: string): Promise<Response> {
    if (!BUNDLE_NAME_RE.test(name)) return notFound();
    if (!(await this.knownNames()).has(name)) return notFound();

    const entry = this.entry(name);
    const identity = await entry.identity;
    if (!identity) return notFound();

    const headers = new Headers({ "Content-Type": identity.contentType, "Cache-Control": IMMUTABLE });
    let body = identity.body;
    if (identity.body.byteLength >= COMPRESS_THRESHOLD) {
      appendVary(headers);
      const encoding = negotiateEncoding(req.headers.get("accept-encoding"));
      const encoded = encoding ? await this.encoded(name, entry, encoding, identity.body) : null;
      if (encoding && encoded) {
        body = encoded;
        headers.set("Content-Encoding", encoding);
      }
    }
    if (identity.etag) {
      // The encoded bytes are not the identity bytes, so a strong tag would
      // promise something untrue.
      const weak = headers.has("content-encoding") && !identity.etag.startsWith("W/");
      headers.set("ETag", weak ? `W/${identity.etag}` : identity.etag);
      // A revalidation the browser makes despite `immutable` gets what Bun's
      // own route gave it, a 304, rather than the whole bundle again.
      if (etagMatches(req.headers.get("if-none-match"), identity.etag)) {
        return new Response(null, { status: 304, headers });
      }
    }
    if (req.method === "HEAD") {
      headers.set("Content-Length", String(body.byteLength));
      return new Response(null, { headers });
    }
    return new Response(body as Uint8Array<ArrayBuffer>, { headers });
  }
}
