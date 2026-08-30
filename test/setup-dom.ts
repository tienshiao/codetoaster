// The DOM the frontend tests render into. Registered as a `bun test` preload
// (see bunfig.toml) because it has to be in place before React DOM is imported,
// and ESM evaluates a file's imports before the file's own body.
//
// Bun's preload is global — it runs for the server tests too, which do not want
// a DOM but must not be broken by one. Happy DOM's registration replaces the
// fetch-family globals with its own implementations, and the server tests hand
// real `Request`s to `Bun.serve` handlers and assert on real `Response`s; those
// checks are identity-based, so a Happy DOM `Response` fails them even though it
// looks the same. Nothing in a component test needs Happy DOM's networking, so
// the natives are captured first and put back afterwards: the frontend gets a
// document, the server keeps Bun's runtime.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

/** The globals Happy DOM overwrites that belong to Bun's runtime rather than to
 * the page. Anything a `Bun.serve` route or a test's `fetch` may touch. */
const NATIVE = [
  "fetch",
  "Request",
  "Response",
  "Headers",
  "FormData",
  "Blob",
  "File",
  "WebSocket",
  "AbortController",
  "AbortSignal",
  "URL",
  "URLSearchParams",
  "TextEncoder",
  "TextDecoder",
  "crypto",
  "ReadableStream",
  "WritableStream",
  "TransformStream",
] as const;

const natives = new Map<string, PropertyDescriptor>();
for (const name of NATIVE) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  if (descriptor) natives.set(name, descriptor);
}

GlobalRegistrator.register();

for (const [name, descriptor] of natives) {
  Object.defineProperty(globalThis, name, descriptor);
}
