import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  directoryExists,
  lookupSymbol,
  searchSymbolNames,
  sweepSymbolIndexes,
  symbolStoreStats,
  _resetStore,
  type ProjectSource,
} from "./store";

beforeEach(() => _resetStore());

// In-memory source with a controllable clock and mutable files.
function makeSource(files: Record<string, string>) {
  const store = new Map<string, { content: string; mtimeMs: number }>();
  for (const [p, content] of Object.entries(files)) store.set(p, { content, mtimeMs: 1 });
  let clock = 1000;
  const source: ProjectSource = {
    listFiles: async () => [...store.keys()],
    stat: async (p) => {
      const f = store.get(p);
      return f ? { mtimeMs: f.mtimeMs, size: f.content.length } : null;
    },
    read: async (p) => store.get(p)?.content ?? "",
    now: () => clock,
  };
  return {
    source,
    write: (p: string, content: string) => store.set(p, { content, mtimeMs: (store.get(p)?.mtimeMs ?? 0) + 1 }),
    remove: (p: string) => store.delete(p),
    advance: (ms: number) => (clock += ms),
  };
}

// Each test uses a distinct dir so the module-level cache doesn't collide.
let n = 0;
const nextDir = () => `/repo/${n++}`;

test("builds an index and finds definitions and references across files", async () => {
  const { source } = makeSource({
    "a.ts": "export function helper() { return 1; }",
    "b.ts": "import { helper } from './a';\nconst x = helper();",
  });
  const dir = nextDir();
  const res = await lookupSymbol(dir, "helper", source);
  expect(res.definitions.map((d) => d.path)).toEqual(["a.ts"]);
  expect(res.definitions[0]?.symbolKind).toBe("function");
  expect(res.references.some((r) => r.path === "b.ts")).toBe(true);
});

test("skips files with no symbol grammar", async () => {
  const { source } = makeSource({ "data.json": '{"helper": 1}', "a.ts": "function helper() {}" });
  const dir = nextDir();
  const res = await lookupSymbol(dir, "helper", source);
  expect(res.definitions).toHaveLength(1);
  expect(res.definitions[0]?.path).toBe("a.ts");
});

test("revalidates changed files after the throttle interval", async () => {
  const ctx = makeSource({ "a.ts": "function alpha() {}" });
  const dir = nextDir();

  let res = await lookupSymbol(dir, "beta", ctx.source);
  expect(res.definitions).toHaveLength(0);

  // Edit the file to rename alpha -> beta, bump mtime, advance past throttle.
  ctx.write("a.ts", "function beta() {}");
  ctx.advance(6000);

  res = await lookupSymbol(dir, "beta", ctx.source);
  expect(res.definitions).toHaveLength(1);
  const stale = await lookupSymbol(dir, "alpha", ctx.source);
  expect(stale.definitions).toHaveLength(0);
});

test("does not revalidate within the throttle interval", async () => {
  const ctx = makeSource({ "a.ts": "function alpha() {}" });
  const dir = nextDir();
  await lookupSymbol(dir, "alpha", ctx.source);

  ctx.write("a.ts", "function beta() {}"); // change without advancing the clock
  const res = await lookupSymbol(dir, "beta", ctx.source);
  expect(res.definitions).toHaveLength(0); // stale index still served
});

test("an immutable source is built once and never revalidated", async () => {
  const ctx = makeSource({ "a.ts": "function alpha() {}" });
  let listings = 0;
  const source: ProjectSource = {
    ...ctx.source,
    immutable: true,
    listFiles: () => {
      listings++;
      return ctx.source.listFiles();
    },
  };
  const dir = nextDir();
  await lookupSymbol(dir, "alpha", source);

  ctx.advance(60_000);
  const res = await lookupSymbol(dir, "alpha", source);
  expect(res.definitions).toHaveLength(1);
  expect(listings).toBe(1);
});

test("a read that fails fails an immutable build, and the index is not kept", async () => {
  const ctx = makeSource({ "a.ts": "function alpha() {}", "b.ts": "function beta() {}" });
  let failing = true;
  const source: ProjectSource = {
    ...ctx.source,
    immutable: true,
    read: async (p) => {
      if (failing && p === "b.ts") throw new Error("blob unreadable");
      return ctx.source.read(p);
    },
  };
  const dir = nextDir();
  // Not an index holding `alpha` and silently missing `beta`.
  await expect(lookupSymbol(dir, "alpha", source)).rejects.toThrow("Failed to read b.ts");

  failing = false;
  expect((await lookupSymbol(dir, "beta", source)).definitions).toHaveLength(1);
});

test("a working tree's unreadable file is skipped, as before", async () => {
  const ctx = makeSource({ "a.ts": "function alpha() {}", "b.ts": "function beta() {}" });
  const source: ProjectSource = {
    ...ctx.source,
    read: async (p) => {
      if (p === "b.ts") throw new Error("permission denied");
      return ctx.source.read(p);
    },
  };
  const dir = nextDir();
  expect((await lookupSymbol(dir, "alpha", source)).definitions).toHaveLength(1);
  expect((await lookupSymbol(dir, "beta", source)).definitions).toHaveLength(0);
});

test("immutable indexes do not evict a working tree's", async () => {
  const tree = makeSource({ "a.ts": "function alpha() {}" });
  let treeListings = 0;
  const treeSource: ProjectSource = {
    ...tree.source,
    listFiles: () => {
      treeListings++;
      return tree.source.listFiles();
    },
  };
  const dir = nextDir();
  await lookupSymbol(dir, "alpha", treeSource);

  // More commits than either cache holds.
  for (let i = 0; i < 8; i++) {
    const commit = makeSource({ "a.ts": "function alpha() {}" });
    await lookupSymbol(`${dir}\0${i}`, "alpha", { ...commit.source, immutable: true });
  }
  await lookupSymbol(dir, "alpha", treeSource);
  expect(treeListings).toBe(1); // still the first build, and inside the throttle
});

test("fuzzy search matches names, counts occurrences, and jumps to the definition", async () => {
  const { source } = makeSource({
    "a.ts": "export function getDiffTokens() { return 1; }",
    "b.ts": "import { getDiffTokens } from './a';\nconst x = getDiffTokens();\nconst y = getDiffTokens();",
  });
  const dir = nextDir();

  const res = await searchSymbolNames(dir, "gdt", source);
  const match = res.matches.find((m) => m.name === "getDiffTokens");
  expect(match).toBeDefined();
  expect(match!.defCount).toBe(1);
  expect(match!.refCount).toBe(2);
  // Primary jump target is the definition, not a reference.
  expect(match!.primary.path).toBe("a.ts");
  expect(match!.primary.kind).toBe("definition");
});

test("empty search query returns no matches", async () => {
  const { source } = makeSource({ "a.ts": "function helper() {}" });
  const dir = nextDir();
  const res = await searchSymbolNames(dir, "   ", source);
  expect(res.matches).toHaveLength(0);
});

test("search ranks a prefix match ahead of a scattered subsequence", async () => {
  const { source } = makeSource({
    "a.ts": "function getUser() {}\nfunction widgetTarget() {}",
  });
  const dir = nextDir();
  const res = await searchSymbolNames(dir, "get", source);
  expect(res.matches[0]?.name).toBe("getUser");
});

test("drops deleted files on revalidation", async () => {
  const ctx = makeSource({ "a.ts": "function gamma() {}" });
  const dir = nextDir();
  await lookupSymbol(dir, "gamma", ctx.source);

  ctx.remove("a.ts");
  ctx.advance(6000);
  const res = await lookupSymbol(dir, "gamma", ctx.source);
  expect(res.definitions).toHaveLength(0);
});

// ── eviction (TASK-142) ─────────────────────────────────────────────────────

/** A source whose directory can be taken away, counting its builds. */
function sweptSource(files: Record<string, string>, extra: Partial<ProjectSource> = {}) {
  const ctx = makeSource(files);
  let present = true;
  let listings = 0;
  const source: ProjectSource = {
    ...ctx.source,
    exists: async () => present,
    listFiles: () => {
      listings++;
      return ctx.source.listFiles();
    },
    ...extra,
  };
  return { ...ctx, source, remove: () => (present = false), listings: () => listings };
}

const HOUR = 60 * 60_000;

test("an index whose directory has gone is dropped by the sweep, and only that one", async () => {
  const gone = sweptSource({ "a.ts": "function alpha() {}" });
  const kept = sweptSource({ "a.ts": "function alpha() {}" });
  const goneDir = nextDir();
  const keptDir = nextDir();
  await lookupSymbol(goneDir, "alpha", gone.source);
  await lookupSymbol(keptDir, "alpha", kept.source);

  expect(await sweepSymbolIndexes({ now: 1000, idleMs: HOUR })).toEqual([]);
  gone.remove();
  expect(await sweepSymbolIndexes({ now: 1000, idleMs: HOUR })).toEqual([goneDir]);
  expect(symbolStoreStats().indexes).toBe(1);
});

test("an index unused for the idle period is dropped, and a use resets the period", async () => {
  const ctx = sweptSource({ "a.ts": "function alpha() {}" });
  const dir = nextDir();
  await lookupSymbol(dir, "alpha", ctx.source); // used at 1000

  ctx.advance(HOUR - 1);
  await lookupSymbol(dir, "alpha", ctx.source); // used again, at 1000 + HOUR - 1
  expect(await sweepSymbolIndexes({ now: 1000 + HOUR + 1, idleMs: HOUR })).toEqual([]);
  expect(await sweepSymbolIndexes({ now: 1000 + 2 * HOUR, idleMs: HOUR })).toEqual([dir]);
});

test("an idle period of 0 drops nothing for being idle", async () => {
  const ctx = sweptSource({ "a.ts": "function alpha() {}" });
  const dir = nextDir();
  await lookupSymbol(dir, "alpha", ctx.source);
  expect(await sweepSymbolIndexes({ now: 1000 + 365 * 24 * HOUR, idleMs: 0 })).toEqual([]);
});

test("a lookup after eviction rebuilds the index and answers as before", async () => {
  const ctx = sweptSource({
    "a.ts": "export function helper() { return 1; }",
    "b.ts": "import { helper } from './a';\nconst x = helper();",
  });
  const dir = nextDir();
  const before = await lookupSymbol(dir, "helper", ctx.source);
  expect(await sweepSymbolIndexes({ now: 1000 + 2 * HOUR, idleMs: HOUR })).toEqual([dir]);

  const after = await lookupSymbol(dir, "helper", ctx.source);
  expect(after).toEqual(before);
  expect(ctx.listings()).toBe(2);
});

test("an index still building is not swept, however idle it looks", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const ctx = sweptSource({ "a.ts": "function alpha() {}" });
  const source: ProjectSource = {
    ...ctx.source,
    listFiles: async () => {
      await gate;
      return ctx.source.listFiles();
    },
  };
  const dir = nextDir();
  const pending = lookupSymbol(dir, "alpha", source);
  ctx.remove();

  expect(await sweepSymbolIndexes({ now: 1000 + 2 * HOUR, idleMs: HOUR })).toEqual([]);
  release();
  expect((await pending).definitions).toHaveLength(1);
});

test("a probe that fails proves nothing, and the index stays", async () => {
  const ctx = sweptSource(
    { "a.ts": "function alpha() {}" },
    { exists: async () => Promise.reject(new Error("EACCES")) },
  );
  const dir = nextDir();
  await lookupSymbol(dir, "alpha", ctx.source);
  expect(await sweepSymbolIndexes({ now: 1000, idleMs: HOUR })).toEqual([]);
});

test("an entry replaced while an earlier probe was pending is not deleted in its place", async () => {
  let releaseProbe!: () => void;
  const probeGate = new Promise<void>((resolve) => (releaseProbe = resolve));
  // The first index's probe holds the sweep open while the second is evicted
  // and built again under the same key.
  const slow = sweptSource({ "a.ts": "function alpha() {}" }, { exists: () => probeGate.then(() => true) });
  const idle = sweptSource({ "a.ts": "function alpha() {}" });
  const slowDir = nextDir();
  const idleDir = nextDir();
  await lookupSymbol(slowDir, "alpha", slow.source);
  slow.advance(HOUR);
  await lookupSymbol(slowDir, "alpha", slow.source); // not idle: the sweep probes it
  await lookupSymbol(idleDir, "alpha", idle.source); // after it in the sweep's order

  const sweep = sweepSymbolIndexes({ now: 1000 + 2 * HOUR + 1, idleMs: 2 * HOUR });
  // Push both out by the cap, then look idleDir up again: a new index, used
  // just now, under the key the sweep's snapshot still pairs with the old one.
  for (let i = 0; i < 4; i++) await lookupSymbol(nextDir(), "alpha", sweptSource({ "a.ts": "" }).source);
  idle.advance(2 * HOUR);
  await lookupSymbol(idleDir, "alpha", idle.source);
  releaseProbe();

  expect(await sweep).not.toContain(idleDir);
  await lookupSymbol(idleDir, "alpha", idle.source);
  expect(idle.listings()).toBe(2);
});

test("directoryExists answers no only for what is not there", async () => {
  const root = mkdtempSync(join(tmpdir(), "symbols-exists-"));
  try {
    writeFileSync(join(root, "file"), "");
    expect(await directoryExists(root)).toBe(true);
    expect(await directoryExists(join(root, "missing"))).toBe(false);
    expect(await directoryExists(join(root, "file"))).toBe(false);
    expect(await directoryExists(join(root, "file", "below"))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commit indexes are bounded, the least recently used going first", async () => {
  const dir = nextDir();
  const commits = Array.from({ length: 4 }, () => {
    const ctx = sweptSource({ "a.ts": "function alpha() {}" });
    return { ...ctx, source: { ...ctx.source, immutable: true } as ProjectSource };
  });
  for (const [i, c] of commits.entries()) await lookupSymbol(`${dir}\0${i}`, "alpha", c.source);
  expect(symbolStoreStats().commitIndexes).toBe(3);

  // The first has gone and is built again, which pushes out the second; the
  // two newest are still held.
  await lookupSymbol(`${dir}\0${0}`, "alpha", commits[0]!.source);
  expect(commits[0]!.listings()).toBe(2);
  for (const i of [2, 3]) {
    await lookupSymbol(`${dir}\0${i}`, "alpha", commits[i]!.source);
    expect(commits[i]!.listings()).toBe(1);
  }
});

test("the store's size is counted for diagnostics", async () => {
  const ctx = sweptSource({ "a.ts": "function alpha() {}\nfunction beta() {}", "b.ts": "alpha();" });
  await lookupSymbol(nextDir(), "alpha", ctx.source);
  const stats = symbolStoreStats();
  expect(stats.indexes).toBe(1);
  expect(stats.commitIndexes).toBe(0);
  expect(stats.files).toBe(2);
  expect(stats.entries).toBeGreaterThanOrEqual(3);
});
