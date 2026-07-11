import type { FileTokens } from "../../types/highlight";
import type { GrammarId } from "./assets";

// Content-addressed LRU for tokenized files. Keying on a content hash (not path)
// dedupes identical old/new diff sides and repeat requests across sessions, and
// is self-invalidating: edited content is simply a new key. A cached value of
// `null` records "known unsupported/oversized" so we don't re-attempt.

interface Entry {
  tokens: FileTokens | null;
  size: number; // content length, for the byte-ish budget
}

const MAX_ENTRIES = 100;
const MAX_TOTAL_CHARS = 30_000_000;

const cache = new Map<string, Entry>();
let totalChars = 0;

function keyFor(grammarId: GrammarId, content: string): string {
  return `${grammarId}:${Bun.hash(content).toString(16)}`;
}

/** Returns the cached tokens, or `undefined` on a miss (note: `null` is a hit). */
export function getCachedTokens(
  grammarId: GrammarId,
  content: string,
): FileTokens | null | undefined {
  const key = keyFor(grammarId, content);
  const entry = cache.get(key);
  if (entry === undefined) return undefined;
  // Mark as most-recently-used.
  cache.delete(key);
  cache.set(key, entry);
  return entry.tokens;
}

export function setCachedTokens(
  grammarId: GrammarId,
  content: string,
  tokens: FileTokens | null,
): void {
  const key = keyFor(grammarId, content);
  const existing = cache.get(key);
  if (existing) {
    totalChars -= existing.size;
    cache.delete(key);
  }
  const entry: Entry = { tokens, size: content.length };
  cache.set(key, entry);
  totalChars += entry.size;
  evict();
}

function evict(): void {
  while (cache.size > MAX_ENTRIES || totalChars > MAX_TOTAL_CHARS) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    const entry = cache.get(oldest.value)!;
    totalChars -= entry.size;
    cache.delete(oldest.value);
  }
}

/** Test-only: clear the cache between cases. */
export function _clearCache(): void {
  cache.clear();
  totalChars = 0;
}
