import { test, expect, describe } from "bun:test";
import { cachedPromise, type CachedPromise } from "./utils";

describe("cachedPromise", () => {
  test("concurrent and in-TTL calls share one promise; an expired entry is remade", async () => {
    const cache = new Map<string, CachedPromise<number>>();
    let made = 0;
    const make = () => Promise.resolve(++made);
    const a = cachedPromise(cache, "k", 60_000, make);
    const b = cachedPromise(cache, "k", 60_000, make);
    expect(a).toBe(b);
    expect(await a).toBe(1);
    cache.get("k")!.at = 0;
    expect(await cachedPromise(cache, "k", 60_000, make)).toBe(2);
  });

  test("a rejection is evicted, but only while it is still the cached entry", async () => {
    const cache = new Map<string, CachedPromise<number>>();
    const failed = cachedPromise(cache, "k", 60_000, () => Promise.reject(new Error("no")));
    await failed.catch(() => {});
    expect(cache.has("k")).toBe(false);

    let reject!: (e: Error) => void;
    const slow = cachedPromise(cache, "k", 60_000, () => new Promise<number>((_, r) => (reject = r)));
    cache.get("k")!.at = 0; // expire it while still in flight
    const replacement = cachedPromise(cache, "k", 60_000, () => Promise.resolve(7));
    reject(new Error("late"));
    await slow.catch(() => {});
    expect(cache.get("k")?.value).toBe(replacement);
  });
});
