import { test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { gitRoutes } from "./git";
import { highlightRoutes } from "./highlight";
import { parseDiff } from "../frontend/utils/parseDiff";
import { initDatabase } from "../lib/db";
import { taskManager } from "../lib/tasks/manager";
import { cleanupRepos, git, tempRepo } from "../../test/git-repo";
import type { FileTokens } from "../types/highlight";

/**
 * A commit's diff relative to something other than its parent (TASK-128): the
 * way a branch is reviewed whole, against the branch it was cut from.
 *
 * The history under test is the one that makes the difference visible — the
 * base has moved on since the branch left it:
 *
 *   first ── fork ── mainTip          (main: adds main-only.txt)
 *              └── f1 ── feature      (f1 edits a.ts, feature adds b.txt)
 */

let server: ReturnType<typeof Bun.serve>;
let api: string;
let dbDir: string;
let fork: string;
let f1: string;
let feature: string;
let mainTip: string;
let lone: string;

beforeAll(async () => {
  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-commitbase-"));
  initDatabase(path.join(dbDir, "codetoaster.db"));
  taskManager.loadProjects();

  const { root } = await tempRepo();
  const commit = async (file: string, content: string, message: string) => {
    fs.writeFileSync(path.join(root, file), content);
    await git(root, "add", "-A");
    await git(root, "commit", "-qm", message);
    return git(root, "rev-parse", "HEAD");
  };

  fork = await commit("a.ts", "export const a = 1;\n", "fork");
  await git(root, "checkout", "-q", "-b", "feature");
  f1 = await commit("a.ts", "export const a = 2;\n", "f1");
  feature = await commit("b.txt", "b\n", "feature");
  await git(root, "checkout", "-q", "main");
  mainTip = await commit("main-only.txt", "main\n", "main moves on");

  // A commit with no history in common with any of the above.
  const emptyTree = await git(root, "hash-object", "-t", "tree", "/dev/null");
  lone = await git(root, "commit-tree", emptyTree, "-m", "lone");

  taskManager.createProject("based", "based", root);
  server = Bun.serve({
    port: 0,
    routes: { ...gitRoutes, ...highlightRoutes } as any,
    fetch: () => new Response("", { status: 404 }),
  });
  api = `http://localhost:${server.port}/api/projects/based`;
});

afterAll(() => {
  server.stop(true);
  cleanupRepos();
  fs.rmSync(dbDir, { recursive: true, force: true });
});

async function commitDiff(query: string): Promise<{ paths: string[]; diffBase: string | null }> {
  const res = await fetch(`${api}/git/commit?${query}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { diff: string; diffBase: string | null };
  return { paths: parseDiff(body.diff).map((f) => f.newPath).sort(), diffBase: body.diffBase };
}

test("without a base, the diff is the commit's own, from its parent", async () => {
  expect(await commitDiff(`sha=${feature}`)).toEqual({ paths: ["b.txt"], diffBase: f1 });
});

test("with a base, the diff is everything since the commit's history left it", async () => {
  // From the fork point, not from the base's tip: `main-only.txt` arrived on
  // main afterwards, and the branch did not delete it.
  expect(await commitDiff(`sha=${feature}&base=${mainTip}`)).toEqual({
    paths: ["a.ts", "b.txt"],
    diffBase: fork,
  });
});

test("an abbreviated base names the same commit", async () => {
  expect(await commitDiff(`sha=${feature}&base=${mainTip.slice(0, 8)}`)).toEqual({
    paths: ["a.ts", "b.txt"],
    diffBase: fork,
  });
});

test("a commit already in the base has nothing to show against it", async () => {
  expect(await commitDiff(`sha=${fork}&base=${mainTip}`)).toEqual({ paths: [], diffBase: fork });
  expect(await commitDiff(`sha=${feature}&base=${feature}`)).toEqual({ paths: [], diffBase: feature });
});

test("histories with nothing in common compare directly", async () => {
  expect(await commitDiff(`sha=${fork}&base=${lone}`)).toEqual({
    paths: ["README.md", "a.ts"],
    diffBase: lone,
  });
});

test("a base that is not a sha is a 400, and one nobody has is a 404", async () => {
  expect((await fetch(`${api}/git/commit?sha=${feature}&base=main`)).status).toBe(400);
  expect((await fetch(`${api}/git/commit?sha=${feature}&base=${"0".repeat(40)}`)).status).toBe(404);
});

async function oldSide(body: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${api}/diff-tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, files: [{ path: "a.ts", needOld: true, needNew: false }] }),
  });
  expect(res.status).toBe(200);
  const { files } = (await res.json()) as { files: Record<string, { old: FileTokens | null }> };
  return (files["a.ts"]!.old ?? []).map((line) => line.map((t) => t.text).join("")).join("\n");
}

test("tokens read the old side from the base when one is named, else the parent", async () => {
  expect(await oldSide({ sha: feature })).toContain("a = 2");
  expect(await oldSide({ sha: feature, base: fork })).toContain("a = 1");
});

test("a token base that is not a sha is a 400", async () => {
  const res = await fetch(`${api}/diff-tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sha: feature, base: "main", files: [] }),
  });
  expect(res.status).toBe(400);
});
