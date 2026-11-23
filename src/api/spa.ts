import { compressResponse } from "./compress";

/** The SPA's HTML as the catch-all route serves it, built from what Bun's
 * HTML import answered on the hidden route.
 *
 * Out of `server.ts` so a test can drive it: that file imports the frontend's
 * HTML entry point, and importing it bundles the whole app. */
export async function serveSpa(req: Request, upstream: Response): Promise<Response> {
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
  // Under the API's rule (TASK-147). Read whole, which is safe here: the body
  // is our own index.html, not a stream of anyone's making.
  return compressResponse(
    req,
    new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers }),
  );
}
