import { test, expect, describe, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { listGitFiles, listIgnoredEntries } from "./file-listing";
import { cleanupRepos, git, tempRepo } from "../../test/git-repo";

/**
 * What the repository ignores, as the Files tree lists it (TASK-130).
 *
 * A real repository, because the shapes under test are git's own: which
 * directories it collapses, and which it lists beside their contents.
 */
describe("listIgnoredEntries", () => {
  afterEach(cleanupRepos);

  async function repoIgnoring(patterns: string): Promise<string> {
    const { root } = await tempRepo();
    fs.writeFileSync(path.join(root, ".gitignore"), patterns);
    await git(root, "add", ".gitignore");
    return root;
  }

  function write(root: string, file: string): void {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), "x\n");
  }

  test("an ignored directory is one entry, however much is inside it", async () => {
    const root = await repoIgnoring("dist/\n");
    write(root, "dist/a.js");
    write(root, "dist/deep/b.js");

    expect(await listIgnoredEntries(root)).toEqual(["dist/"]);
  });

  test("an ignored file is listed where it is, beside files that are not", async () => {
    const root = await repoIgnoring(".env\n*.log\n");
    write(root, ".env");
    write(root, "src/a.ts");
    write(root, "src/debug.log");

    expect(await listIgnoredEntries(root)).toEqual([".env", "src/debug.log"]);
    // And the ordinary listing still leaves them out: the two never overlap.
    expect((await listGitFiles(root)).sort()).toEqual([".gitignore", "README.md", "src/a.ts"]);
  });

  test("a directory holding only ignored files is not itself an entry", async () => {
    // git lists `out/` *and* `out/a.log` here, though no rule names `out`. The
    // directory is an ordinary one that happens to hold nothing else, and
    // reporting it as ignored would hide the file it was listed for.
    const root = await repoIgnoring("*.log\ncache\n");
    write(root, "out/a.log");
    write(root, "pkg/cache/x");

    expect(await listIgnoredEntries(root)).toEqual(["out/a.log", "pkg/cache/"]);
  });

  test("an ignored directory with a tracked file in it is listed one level down", async () => {
    const root = await repoIgnoring("dist/\n");
    write(root, "dist/keep.js");
    write(root, "dist/a.js");
    write(root, "dist/deep/b.js");
    await git(root, "add", "-f", "dist/keep.js");

    expect(await listIgnoredEntries(root)).toEqual(["dist/a.js", "dist/deep/"]);
  });

  test("a repository that ignores nothing has no entries", async () => {
    const { root } = await tempRepo();
    expect(await listIgnoredEntries(root)).toEqual([]);
  });

  test("a directory that is not a repository throws, as the file listing does", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-notrepo-"));
    try {
      await expect(listIgnoredEntries(dir)).rejects.toThrow();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
