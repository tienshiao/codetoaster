import { test, expect, beforeEach } from "bun:test";
import { lookupSymbol, searchSymbolNames, _resetStore, type ProjectSource } from "./store";

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
