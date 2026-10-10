import { test, expect, describe, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { cachedPromise, gitSpawn, listGitFiles, listIgnoredEntries, type CachedPromise } from "./utils";
import { cleanupRepos, git, tempRepo } from "../../test/git-repo";

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

// Exercising the timeout needs a git that really hangs, because the thing being
// verified is that the child dies — a stubbed promise cannot show that.
//
// The shim has to be on the PATH the *spawning process started with*: Bun.spawn
// resolves the executable from the environment captured at startup, so mutating
// process.env.PATH inside this test would still find the real git. Hence a child
// bun process with a doctored PATH, which then calls the real gitSpawn.
// A fractional duration unique to this run, so the orphan check below cannot
// be tripped by an unrelated `sleep` that happens to be running on the machine.
const HANG_DURATION = `30.${process.pid}`;

function makeShimDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-git-shim-"));
  const shim = path.join(dir, "git");
  fs.writeFileSync(shim, `#!/bin/sh\nexec sleep ${HANG_DURATION}\n`);
  fs.chmodSync(shim, 0o755);
  return dir;
}

let shimDir: string | null = null;
afterEach(() => {
  if (shimDir) fs.rmSync(shimDir, { recursive: true, force: true });
  shimDir = null;
});

describe("gitSpawn", () => {
  test("kills a git that outlives its timeout, rather than abandoning it", () => {
    shimDir = makeShimDir();
    const script = `
      import { gitSpawn } from ${JSON.stringify(path.join(import.meta.dir, "utils.ts"))};
      const started = Date.now();
      const { exitCode } = await gitSpawn(process.cwd(), ["rev-parse", "HEAD"], { timeoutMs: 150 });
      console.log(JSON.stringify({ elapsed: Date.now() - started, exitCode }));
    `;
    const proc = Bun.spawnSync(["bun", "-e", script], {
      env: { ...process.env, PATH: `${shimDir}:${process.env.PATH}` },
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = new TextDecoder().decode(proc.stdout).trim();
    expect(out).not.toBe("");
    const { elapsed, exitCode } = JSON.parse(out.split("\n").at(-1)!);

    // Returned on the timeout, not after the shim's sleep.
    expect(elapsed).toBeLessThan(30_000);
    // 143 = 128 + SIGTERM, so callers' `exitCode !== 0` check treats a timeout
    // as a failed lookup with no special casing.
    expect(exitCode).not.toBe(0);

    // And the child is actually gone rather than orphaned — the bug this option
    // exists to prevent. pgrep matches the full command line, finding the
    // `sleep` the shim exec'd into.
    const pgrep = Bun.spawnSync(["pgrep", "-f", `^sleep ${HANG_DURATION}$`], { stdout: "pipe" });
    expect(new TextDecoder().decode(pgrep.stdout).trim()).toBe("");
  });

  test("leaves a command that finishes inside its budget alone", async () => {
    const { stdout, exitCode } = await gitSpawn(process.cwd(), ["rev-parse", "--abbrev-ref", "HEAD"], {
      timeoutMs: 10_000,
    });
    expect(exitCode).toBe(0);
    expect(stdout.trim().length).toBeGreaterThan(0);
  });

  test("runs without a timeout when none is given", async () => {
    const { exitCode } = await gitSpawn(process.cwd(), ["rev-parse", "--abbrev-ref", "HEAD"]);
    expect(exitCode).toBe(0);
  });
});

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
