import { test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { cleanupRepos, git, tempRepo } from "../../../test/git-repo";
import { commitSource, lookupCommitSymbol, parseBatch, parseTree } from "./commitSource";
import { _resetStore } from "./store";

beforeEach(() => _resetStore());
afterEach(() => cleanupRepos());

/** A repository whose first commit defines `helper`, and whose second renames
 * it to `renamed` and adds a file. Returns both hashes. */
async function repoWithHistory() {
  const { root } = await tempRepo();
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src/a.ts"), "export function helper() { return 1; }\n");
  fs.writeFileSync(path.join(root, "src/b.ts"), "import { helper } from './a';\nconst x = helper();\n");
  await git(root, "add", "-A");
  await git(root, "commit", "-qm", "helper");
  const before = await git(root, "rev-parse", "HEAD");

  fs.writeFileSync(path.join(root, "src/a.ts"), "export function renamed() { return 1; }\n");
  fs.writeFileSync(path.join(root, "src/b.ts"), "import { renamed } from './a';\nconst x = renamed();\n");
  fs.writeFileSync(path.join(root, "src/c.ts"), "export function later() {}\n");
  await git(root, "add", "-A");
  await git(root, "commit", "-qm", "renamed");
  const after = await git(root, "rev-parse", "HEAD");
  return { root, before, after };
}

test("a lookup answers from the commit's files, not from a later commit or the working tree", async () => {
  const { root, before, after } = await repoWithHistory();
  // The working tree moves on again; neither commit's answer may follow it.
  fs.writeFileSync(path.join(root, "src/a.ts"), "export function uncommitted() {}\n");

  const old = await lookupCommitSymbol(root, before, "helper");
  expect(old.definitions.map((d) => `${d.path}:${d.line}`)).toEqual(["src/a.ts:1"]);
  expect(old.references.some((r) => r.path === "src/b.ts" && r.line === 2)).toBe(true);
  expect((await lookupCommitSymbol(root, before, "renamed")).definitions).toEqual([]);
  expect((await lookupCommitSymbol(root, before, "later")).definitions).toEqual([]);

  const next = await lookupCommitSymbol(root, after, "renamed");
  expect(next.definitions.map((d) => d.path)).toEqual(["src/a.ts"]);
  expect((await lookupCommitSymbol(root, after, "helper")).definitions).toEqual([]);
  expect((await lookupCommitSymbol(root, after, "uncommitted")).definitions).toEqual([]);
});

test("every file is indexed when the blobs take several batches", async () => {
  const { root, after } = await repoWithHistory();
  // A budget smaller than any file: one blob per batch.
  const source = commitSource(root, after, 1);
  for (const name of ["renamed", "later"]) {
    const found = await lookupCommitSymbol(root, after, name, source);
    expect(found.definitions).toHaveLength(1);
  }
  expect((await lookupCommitSymbol(root, after, "renamed", source)).references.length).toBeGreaterThan(0);
});

test("content is cut by bytes, so a multi-byte file does not shift the ones after it", async () => {
  const { root } = await tempRepo();
  fs.writeFileSync(path.join(root, "a.ts"), "// héllo → wörld ✓\nexport function first() {}\n");
  fs.writeFileSync(path.join(root, "b.ts"), "export function second() {}\n");
  await git(root, "add", "-A");
  await git(root, "commit", "-qm", "unicode");
  const sha = await git(root, "rev-parse", "HEAD");

  const source = commitSource(root, sha);
  expect(await source.read("a.ts")).toBe("// héllo → wörld ✓\nexport function first() {}\n");
  expect(await source.read("b.ts")).toBe("export function second() {}\n");
  expect((await lookupCommitSymbol(root, sha, "second")).definitions.map((d) => d.line)).toEqual([1]);
});

test("a symlink is not read as source, and a file the commit lacks is not there", async () => {
  const { root } = await tempRepo();
  fs.writeFileSync(path.join(root, "real.ts"), "export function real() {}\n");
  fs.symlinkSync("real.ts", path.join(root, "link.ts"));
  await git(root, "add", "-A");
  await git(root, "commit", "-qm", "link");
  const sha = await git(root, "rev-parse", "HEAD");

  const source = commitSource(root, sha);
  expect(await source.listFiles()).toEqual(["README.md", "real.ts"]);
  expect(await source.stat("link.ts")).toBeNull();
  expect(await source.stat("real.ts")).toEqual({ mtimeMs: 0, size: 26 });
  expect(await source.read("nope.ts")).toBe("");
  // A file the store would not index is still readable on its own.
  expect(await source.read("README.md")).toBe("on main\n");
});

test("a commit that does not exist fails the lookup, and is not remembered as empty", async () => {
  const { root, mainSha } = await tempRepo();
  const missing = "0".repeat(40);
  await expect(lookupCommitSymbol(root, missing, "helper")).rejects.toThrow();
  // Cached as an empty index, the second ask would answer instead of failing.
  await expect(lookupCommitSymbol(root, missing, "helper")).rejects.toThrow();
  expect((await lookupCommitSymbol(root, mainSha, "helper")).definitions).toEqual([]);
});

test("parseTree keeps regular files only and reads padded sizes", () => {
  const listing = parseTree(
    [
      "100644 blob aaa      12\tsrc/a.ts",
      "100755 blob bbb 1048576\tsrc/big.ts",
      "120000 blob ccc       7\tsrc/link.ts",
      "160000 commit ddd       -\tvendor/sub",
      "100644 blob eee       3\tname with\ttab.md",
      "",
    ].join("\0"),
  );
  expect(listing.paths).toEqual(["src/a.ts", "src/big.ts", "name with\ttab.md"]);
  expect(listing.blobs.get("src/big.ts")?.size).toBe(1048576);
  // Over the size cap, and not a source file: neither is read ahead.
  expect(listing.indexed.map((blob) => blob.path)).toEqual(["src/a.ts"]);
});

test("parseBatch steps over an object git does not have", () => {
  const bytes = new TextEncoder().encode("aaa blob 3\nabc\nbbb missing\nccc blob 2\nhi\n");
  const blobs = ["a", "b", "c"].map((p) => ({ path: p, oid: p.repeat(3), size: 0 }));
  expect([...parseBatch(bytes, blobs)]).toEqual([
    ["a", "abc"],
    ["c", "hi"],
  ]);
});
