/** One entry of a `cachedPromise` cache. */
export interface CachedPromise<T> {
  at: number;
  value: Promise<T>;
}

/**
 * `make()`, at most once per `ttlMs` for `key`.
 *
 * The *promise* is cached rather than its value, so requests arriving while
 * one is in flight share it instead of starting their own — the point, for
 * callers that would otherwise fork a git process per request for the same
 * answer. A rejection is evicted as soon as it lands, or the first failure
 * ("not a repository", most often) would be the answer for the rest of the
 * TTL after it stopped being true — but only while it is still the cached
 * entry, since a later request may already have replaced it.
 */
export function cachedPromise<T>(
  cache: Map<string, CachedPromise<T>>,
  key: string,
  ttlMs: number,
  make: () => Promise<T>,
): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;

  const value = make();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => {
    if (cache.get(key)?.value === value) cache.delete(key);
  });
  return value;
}

// Parse a query param that must be a non-negative integer. Returns the default
// when absent, or null when present-but-invalid (caller responds 400).
export function parseNonNegInt(raw: string | null, def: number): number | null {
  if (raw === null) return def;
  if (!/^\d+$/.test(raw)) return null;
  return parseInt(raw, 10);
}

export const SHA_RE = /^[0-9a-f]{4,40}$/i;

/** `Promise.all` with at most `limit` of the promises alive at a time.
 *
 * Results come back in input order whatever order they finished in. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

interface Coalesced {
  running: Promise<unknown>;
  /** The rerun promised to callers who arrived while `running` was under way. */
  queued: Promise<unknown> | null;
}

const inFlight = new Map<string, Coalesced>();

function startCoalesced<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const slot: Coalesced = { running: Promise.resolve(), queued: null };
  slot.running = fn().finally(() => {
    if (inFlight.get(key) === slot) inFlight.delete(key);
  });
  inFlight.set(key, slot);
  return slot.running as Promise<T>;
}

/** Run `fn`, sharing the work with everyone else who asks under the same key
 * while it is under way.
 *
 * Callers who arrive mid-run do not get the run's answer. A refetch of the
 * working-tree diff is made *because* the checkout changed, and a computation
 * that listed the files before that write cannot include it; hand the late
 * caller those bytes and nothing refetches afterwards, so the last file of a
 * burst never appears. Instead every late caller is promised one further run,
 * started as the current one settles — one, however many arrive, which is all
 * the sharing a burst needs. A caller who arrives during that rerun queues the
 * next, and so on: a steady stream of invalidations runs the computation back
 * to back rather than in parallel, and every answer is at least as fresh as
 * the request that asked for it.
 *
 * Entries are cleared as they settle: this is coalescing, not caching. */
export function coalesce<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const slot = inFlight.get(key);
  if (!slot) return startCoalesced(key, fn);
  if (!slot.queued) {
    // Attached after the `finally` that clears the slot, so by the time this
    // runs the map is usually empty for the key and the rerun registers as a
    // new slot. Usually: the clear and this callback are two microtasks, and a
    // handler resuming from its own `await` between them finds no slot and
    // starts a run of its own. Going back through `coalesce` rather than
    // straight to `startCoalesced` queues behind that run instead of running
    // alongside it — its answer is as fresh as the rerun's would have been.
    const rerun = () => coalesce(key, fn);
    slot.queued = slot.running.then(rerun, rerun);
  }
  return slot.queued as Promise<T>;
}
