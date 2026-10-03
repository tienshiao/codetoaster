import { test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileRoutes } from "./files";
import { symbolRoutes } from "./symbols";
import { initDatabase } from "../lib/db";
import { taskManager } from "../lib/tasks/manager";
import { _resetStore } from "../lib/symbols/store";
import { cleanupRepos, git, tempRepo } from "../../test/git-repo";
import type { SymbolLookupResult } from "../lib/symbols/types";

/**
 * The routes a commit's File Tree reads through that a file tab reads from the
 * working tree (TASK-127): symbols with `sha`, and an image at a ref. Driven
 * through a real `Bun.serve`, so the params and status codes are the ones a
 * client gets.
 */

let server: ReturnType<typeof Bun.serve>;
let base: string;
let dbDir: string;
let sha: string;

const PIXELS = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x0a, 0x01]);

beforeAll(async () => {
  _resetStore();
  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-commitscope-"));
  initDatabase(path.join(dbDir, "codetoaster.db"));
  taskManager.loadProjects();

  const { root } = await tempRepo();
  fs.writeFileSync(path.join(root, "a.ts"), "export function committed() {}\n");
  fs.writeFileSync(path.join(root, "logo.png"), PIXELS);
  await git(root, "add", "-A");
  await git(root, "commit", "-qm", "symbols");
  sha = await git(root, "rev-parse", "HEAD");
  // The working tree moves on from the commit.
  fs.writeFileSync(path.join(root, "a.ts"), "export function edited() {}\n");
  fs.writeFileSync(path.join(root, "logo.png"), new Uint8Array([1, 2, 3]));

  taskManager.createProject("scoped", "scoped", root);
  server = Bun.serve({
    port: 0,
    routes: { ...symbolRoutes, ...fileRoutes } as any,
    fetch: () => new Response("", { status: 404 }),
  });
  base = `http://localhost:${server.port}/api/projects/scoped`;
});

afterAll(() => {
  server.stop(true);
  cleanupRepos();
  fs.rmSync(dbDir, { recursive: true, force: true });
});

async function definitions(query: string): Promise<string[]> {
  const res = await fetch(`${base}/symbols?${query}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as SymbolLookupResult).definitions.map((d) => d.path);
}

test("with a sha, symbols come from that commit's files", async () => {
  expect(await definitions(`name=committed&sha=${sha}`)).toEqual(["a.ts"]);
  expect(await definitions(`name=edited&sha=${sha}`)).toEqual([]);
});

test("an abbreviated sha answers from the same commit", async () => {
  expect(await definitions(`name=committed&sha=${sha.slice(0, 8)}`)).toEqual(["a.ts"]);
});

test("without one, they come from the working tree", async () => {
  expect(await definitions("name=edited")).toEqual(["a.ts"]);
  expect(await definitions("name=committed")).toEqual([]);
});

test("a sha that is not one, or not a commit here, is refused", async () => {
  expect((await fetch(`${base}/symbols?name=committed&sha=HEAD;x`)).status).toBe(400);
  expect((await fetch(`${base}/symbols?name=committed&sha=${"0".repeat(40)}`)).status).toBe(404);
});

test("an image at a ref is the committed blob, byte for byte", async () => {
  const res = await fetch(`${base}/image/git?ref=${sha}&file=logo.png`);
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("image/png");
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(PIXELS);

  // The blob at a full hash cannot change; at a ref that can move, it can.
  expect(res.headers.get("Cache-Control")).toContain("immutable");
  const moving = await fetch(`${base}/image/git?ref=HEAD&file=logo.png`);
  expect(moving.status).toBe(200);
  expect(moving.headers.get("Cache-Control")).toBe("no-cache");

  expect((await fetch(`${base}/image/git?ref=${sha}&file=missing.png`)).status).toBe(404);
});

test("a ref that looks like an option is not run as one", async () => {
  const out = path.join(dbDir, "written-by-git");
  const res = await fetch(`${base}/image/git?ref=${encodeURIComponent(`--output=${out}`)}&file=logo.png`);
  expect(res.status).toBe(404);
  expect(fs.existsSync(`${out}:logo.png`)).toBe(false);
});
