import { test, expect, describe, afterEach, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  coalesce,
  diffUntrackedFiles,
  gitSpawn,
  listGitFiles,
  mapWithConcurrency,
  settledStages,
  withoutGitlinks,
} from "./utils";
import { diffRoutes } from "./diff";
import { gitRoutes } from "./git";
import { MAX_DIFF_LINE_CHARS } from "./diff-cap";
import { parseDiff } from "../frontend/utils/parseDiff";
import { initDatabase, getDatabase } from "../lib/db";
import { TaskStore } from "../lib/tasks/store";
import { taskManager } from "../lib/tasks/manager";
import { cleanupRepos, git, tempRepo } from "../../test/git-repo";

// The untracked half of the working-tree diff (TASK-113).
//
// What used to be one `git diff --no-index /dev/null <file>` per untracked file
// is now one `git add -N` and one `git diff` against a scratch index. The
// contract is that nobody can tell: the bytes are the old bytes, only the
// process count changed.

afterEach(cleanupRepos);

/** What the per-file diff printed for these paths, in this order.
 *
 * With one deliberate difference from what the route used to run: the `--`.
 * Without it a file whose name starts with a dash was read as an option and
 * silently left out, which is the one place the new output is allowed to
 * differ from the old. */
async function perFileDiff(dir: string, files: string[]): Promise<string> {
  let out = "";
  for (const file of files) {
    const { stdout } = await gitSpawn(dir, ["diff", "--no-index", "--", "/dev/null", file]);
    out += stdout;
  }
  return out;
}

describe("diffUntrackedFiles", () => {
  test("prints exactly what the per-file diff printed, whatever the files hold", async () => {
    const { root } = await tempRepo();
    // The kinds of file the old code met: text, binary, empty, no trailing
    // newline, a space in the name, a name that reads as pathspec magic, and a
    // symlink. Plus a modified tracked file and a staged one, which must not
    // leak into the untracked diff from the scratch index.
    fs.writeFileSync(path.join(root, "a.txt"), "hello\nworld\n");
    fs.writeFileSync(path.join(root, "bin.dat"), Buffer.from([0, 1, 2, 255]));
    fs.writeFileSync(path.join(root, "empty.txt"), "");
    fs.writeFileSync(path.join(root, "noeol.txt"), "noeol");
    fs.mkdirSync(path.join(root, "sub dir"));
    fs.writeFileSync(path.join(root, "sub dir", "b c.txt"), "x");
    fs.writeFileSync(path.join(root, ":magic.txt"), "w\n");
    fs.symlinkSync("a.txt", path.join(root, "link.txt"));
    // A tracked file deleted in the working tree, and an empty one, so that
    // rename detection has an empty deletion to pair the empty addition with.
    fs.writeFileSync(path.join(root, "was-empty.txt"), "");
    fs.writeFileSync(path.join(root, "was-here.txt"), "here\n");
    await git(root, "add", "was-empty.txt", "was-here.txt");
    await git(root, "commit", "-qm", "tracked");
    fs.unlinkSync(path.join(root, "was-empty.txt"));
    fs.unlinkSync(path.join(root, "was-here.txt"));
    fs.writeFileSync(path.join(root, "README.md"), "modified\n");
    fs.writeFileSync(path.join(root, "staged.txt"), "staged\n");
    await git(root, "add", "staged.txt");

    const files = await listGitFiles(root, { cached: false });
    expect(files).toContain(":magic.txt");
    expect(files).toContain("empty.txt");
    expect(files).not.toContain("staged.txt");

    const diff = await diffUntrackedFiles(root);

    expect(diff).toBe(await perFileDiff(root, files));
    expect(diff).toContain("+++ b/:magic.txt");
    expect(diff).toContain("new file mode 120000");
    expect(diff).toContain("diff --git a/empty.txt b/empty.txt");
    expect(diff).not.toContain("staged");
    expect(diff).not.toContain("modified");
    expect(diff).not.toContain("was-");
    // The live index was never opened: still unstaged, still staged, still
    // deleted-but-not-staged.
    const status = await gitSpawn(root, ["status", "--porcelain", "README.md", "staged.txt", "was-here.txt"]);
    expect(status.stdout).toBe(" M README.md\nA  staged.txt\n D was-here.txt\n");
  });

  test("a nested repository is skipped, as it always was, with or without commits", async () => {
    const { root } = await tempRepo();
    fs.mkdirSync(path.join(root, "bare-nested"));
    await git(path.join(root, "bare-nested"), "init", "-q");
    fs.writeFileSync(path.join(root, "bare-nested", "inner.txt"), "n\n");
    fs.mkdirSync(path.join(root, "committed-nested"));
    await git(path.join(root, "committed-nested"), "init", "-q");
    await git(path.join(root, "committed-nested"), "-c", "user.email=t@e", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "x");
    fs.writeFileSync(path.join(root, "outer.txt"), "o\n");

    const files = await listGitFiles(root, { cached: false });
    expect(files).toEqual(["bare-nested/", "committed-nested/", "outer.txt"]);

    const diff = await diffUntrackedFiles(root);
    expect(diff).toBe(await perFileDiff(root, ["outer.txt"]));
  });

  test("a conflicted file mid-merge is the unstaged diff's business, not a new file", async () => {
    const { root } = await tempRepo();
    // `tempRepo`'s other branch rewrote README.md; rewriting it on main too
    // makes the merge a conflict rather than a fast-forward.
    fs.writeFileSync(path.join(root, "README.md"), "on main, again\n");
    await git(root, "commit", "-qam", "diverge");
    fs.writeFileSync(path.join(root, "u.txt"), "u\n");
    const merge = await gitSpawn(root, ["merge", "other"]);
    expect(merge.exitCode).not.toBe(0);
    expect((await gitSpawn(root, ["ls-files", "--unmerged"])).stdout).not.toBe("");

    const diff = await diffUntrackedFiles(root);
    expect(diff).toBe(await perFileDiff(root, ["u.txt"]));
    // And the merge is still in progress in the real index.
    expect((await gitSpawn(root, ["ls-files", "--unmerged"])).stdout).not.toBe("");
  });

  test("a repository with no index file yet is fine: everything is untracked", async () => {
    const { root } = await tempRepo();
    const fresh = path.join(root, "fresh");
    fs.mkdirSync(fresh);
    await git(fresh, "init", "-q");
    fs.writeFileSync(path.join(fresh, "first.txt"), "first\n");
    expect(fs.existsSync(path.join(fresh, ".git", "index"))).toBe(false);

    expect(await diffUntrackedFiles(fresh)).toBe(await perFileDiff(fresh, ["first.txt"]));
  });

  test("a file git cannot read takes the per-file path, where a dash is not an option", async () => {
    // Root reads anything, so the unreadable file would not be unreadable.
    if (process.getuid?.() === 0) return;
    const { root } = await tempRepo();
    fs.writeFileSync(path.join(root, "-dash.txt"), "d\n");
    fs.writeFileSync(path.join(root, "ok.txt"), "o\n");
    fs.writeFileSync(path.join(root, "sealed.txt"), "s\n", { mode: 0o000 });

    const files = await listGitFiles(root, { cached: false });
    expect(files).toEqual(["-dash.txt", "ok.txt", "sealed.txt"]);
    const diff = await diffUntrackedFiles(root);

    expect(diff).toBe(await perFileDiff(root, files));
    expect(diff).toContain("+++ b/-dash.txt");
    expect(diff).toContain("+++ b/ok.txt");
    expect(diff).not.toContain("sealed");
  });

  test("a clean checkout is an empty string", async () => {
    const { root } = await tempRepo();
    expect(await diffUntrackedFiles(root)).toBe("");
  });

  // The whole point. Counted from a child bun process with a logging `git`
  // shim first on PATH, for the reason `utils.test.ts` spells out: Bun.spawn
  // resolves the executable from the environment it started with, so a PATH
  // doctored inside this process would still find the real git.
  test("spawns four gits for two thousand files, not two thousand", async () => {
    const { root } = await tempRepo();
    fs.mkdirSync(path.join(root, "build"));
    for (let i = 0; i < 2000; i++) {
      fs.writeFileSync(path.join(root, "build", `f${i}.o`), `object ${i}\n`);
    }

    const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-git-count-"));
    const log = path.join(shimDir, "spawns.log");
    const realGit = Bun.which("git");
    expect(realGit).not.toBeNull();
    fs.writeFileSync(
      path.join(shimDir, "git"),
      `#!/bin/sh\necho "$@" >> ${JSON.stringify(log)}\nexec ${JSON.stringify(realGit)} "$@"\n`,
    );
    fs.chmodSync(path.join(shimDir, "git"), 0o755);
    try {
      const script = `
        import { diffUntrackedFiles } from ${JSON.stringify(path.join(import.meta.dir, "utils.ts"))};
        const diff = await diffUntrackedFiles(${JSON.stringify(root)});
        console.log(JSON.stringify({ lines: diff.split("\\n").length }));
      `;
      const proc = Bun.spawnSync(["bun", "-e", script], {
        env: { ...process.env, PATH: `${shimDir}:${process.env.PATH}` },
        stdout: "pipe",
        stderr: "pipe",
      });
      const out = new TextDecoder().decode(proc.stdout).trim();
      expect(out).not.toBe("");
      const { lines } = JSON.parse(out.split("\n").at(-1)!);
      // Seven lines of diff per file — header, mode, index, ---, +++, hunk,
      // the one line of content — plus the split's trailing element.
      expect(lines).toBe(2000 * 7 + 1);

      const spawned = fs.readFileSync(log, "utf8").split("\n").filter(Boolean);
      // Where the index is and what is unmerged (in either order), the
      // intent-to-add, the diff. Not one per file.
      expect(spawned.length).toBe(4);
      expect(spawned.slice(0, 2).map((s) => s.split(" ").at(-1)).sort()).toEqual(["--unmerged", "index"]);
      expect(spawned[2]).toContain("add --intent-to-add");
      expect(spawned[3]).toContain(" diff --no-renames --diff-filter=A");
    } finally {
      fs.rmSync(shimDir, { recursive: true, force: true });
    }
  });
});

// The route, over a real server and a task row with no process behind it —
// the state a task is browsed in most of the time.
describe("GET /api/tasks/:id/diff", () => {
  let dbDir: string;
  let server: ReturnType<typeof Bun.serve>;

  beforeAll(() => {
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-diffroute-"));
    initDatabase(path.join(dbDir, "codetoaster.db"));
    taskManager.loadProjects();
    server = Bun.serve({
      port: 0,
      routes: { ...diffRoutes, ...gitRoutes } as any,
      fetch: () => new Response("", { status: 404 }),
    });
  });

  afterAll(() => {
    server.stop(true);
    fs.rmSync(dbDir, { recursive: true, force: true });
  });

  test("unstaged, then staged, then untracked; identical for two callers at once", async () => {
    const { root } = await tempRepo();
    fs.writeFileSync(path.join(root, "README.md"), "modified\n");
    fs.writeFileSync(path.join(root, "staged.txt"), "staged\n");
    await git(root, "add", "staged.txt");
    fs.writeFileSync(path.join(root, "new.txt"), "untracked\n");
    new TaskStore(getDatabase()).create({
      id: "diffed",
      project_id: "general",
      title: "diffed",
      initial_prompt: "",
      repo_root: root,
      cwd: root,
      lifecycle: "suspended",
    });

    const url = `http://localhost:${server.port}/api/tasks/diffed/diff`;
    const [a, b] = await Promise.all([fetch(url), fetch(url)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const one = (await a.json()) as { diff: string; directory: string; hash: string };
    const two = (await b.json()) as { diff: string; directory: string; hash: string };
    expect(two).toEqual(one);
    expect(one.directory).toBe(root);

    const at = (needle: string) => one.diff.indexOf(needle);
    expect(at("+modified")).toBeGreaterThan(-1);
    expect(at("+staged")).toBeGreaterThan(at("+modified"));
    expect(at("+untracked")).toBeGreaterThan(at("+staged"));
    expect(one.diff.endsWith("+untracked\n")).toBe(true);
  });

  // TASK-117: one single-line data file used to be most of a 50 MB payload.
  test("a file with a megabyte line is headers and a marker; its neighbours keep their hunks", async () => {
    const { root } = await tempRepo();
    fs.writeFileSync(path.join(root, "big.json"), "[]\n");
    await git(root, "add", "big.json");
    await git(root, "commit", "-qm", "small big.json");
    fs.writeFileSync(path.join(root, "big.json"), "[" + "1,".repeat(750_000) + "1]");
    fs.writeFileSync(path.join(root, "README.md"), "modified\n");
    new TaskStore(getDatabase()).create({
      id: "oversized",
      project_id: "general",
      title: "oversized",
      initial_prompt: "",
      repo_root: root,
      cwd: root,
      lifecycle: "suspended",
    });

    const res = await fetch(`http://localhost:${server.port}/api/tasks/oversized/diff`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body.length).toBeLessThan(20_000);
    const { diff } = JSON.parse(body) as { diff: string };
    expect(diff).toContain("Oversized diff omitted: ");

    const files = parseDiff(diff);
    const big = files.find((f) => f.newPath === "big.json")!;
    // "[" + 1.5M + "1]": the file's line, without the diff line's "+".
    expect(big.oversized?.longestLine).toBe(1_500_003);
    expect(big.hunks).toHaveLength(0);
    expect(big.additions).toBe(1);
    expect(big.deletions).toBe(1);
    const readme = files.find((f) => f.newPath === "README.md")!;
    expect(readme.oversized).toBeUndefined();
    expect(readme.hunks).toHaveLength(1);

    // The commit that lands the file is capped the same way in History.
    await git(root, "commit", "-qam", "big big.json");
    const sha = await git(root, "rev-parse", "HEAD");
    const commitRes = await fetch(`http://localhost:${server.port}/api/tasks/oversized/git/commit?sha=${sha}`);
    expect(commitRes.status).toBe(200);
    const commitBody = await commitRes.text();
    expect(commitBody.length).toBeLessThan(20_000);
    const commitFiles = parseDiff((JSON.parse(commitBody) as { diff: string }).diff);
    expect(commitFiles.find((f) => f.newPath === "big.json")!.oversized).toBeDefined();
    expect(commitFiles.find((f) => f.newPath === "README.md")!.hunks).toHaveLength(1);
  });

  test("hunk expansion cuts a line past the length budget and marks it cut", async () => {
    const { root } = await tempRepo();
    const long = "z".repeat(30_000);
    fs.writeFileSync(path.join(root, "wide.ts"), `const a = 1;\n${long}\nconst b = 2;\n`);
    new TaskStore(getDatabase()).create({
      id: "context-cap",
      project_id: "general",
      title: "context-cap",
      initial_prompt: "",
      repo_root: root,
      cwd: root,
      lifecycle: "suspended",
    });

    const res = await fetch(`http://localhost:${server.port}/api/tasks/context-cap/context?file=wide.ts&start=1&end=3`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lines: { lineNum: number; content: string }[]; tokens: unknown[] | null };
    const suffix = ` … (+${30_000 - MAX_DIFF_LINE_CHARS} chars)`;
    expect(body.lines.map((l) => l.lineNum)).toEqual([1, 2, 3]);
    expect(body.lines[0]!.content).toBe("const a = 1;");
    expect(body.lines[1]!.content.length).toBeLessThanOrEqual(MAX_DIFF_LINE_CHARS + suffix.length);
    expect(body.lines[1]!.content).toBe("z".repeat(MAX_DIFF_LINE_CHARS) + suffix);
    expect(body.lines[2]!.content).toBe("const b = 2;");
    if (body.tokens) expect(body.tokens[1]).toEqual([]);
  });

  test("a task nobody has heard of is a 404", async () => {
    const res = await fetch(`http://localhost:${server.port}/api/tasks/nope/diff`);
    expect(res.status).toBe(404);
  });
});

describe("diffUntrackedFiles under a build", () => {
  // The add dying is what a file vanishing mid-walk looks like from here, and
  // a shim that dies on purpose is the only way to make it happen on cue.
  // Same child-process arrangement as the spawn count above, for the same
  // reason.
  test("an add that dies twice is tried again, and the answer is whole", async () => {
    const { root } = await tempRepo();
    fs.writeFileSync(path.join(root, "a.txt"), "a\n");
    fs.writeFileSync(path.join(root, "b.txt"), "b\n");

    const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-git-dies-"));
    const counter = path.join(shimDir, "deaths");
    const realGit = Bun.which("git")!;
    fs.writeFileSync(
      path.join(shimDir, "git"),
      [
        "#!/bin/sh",
        `for a in "$@"; do if [ "$a" = "add" ]; then`,
        `  n=$(cat ${JSON.stringify(counter)} 2>/dev/null || echo 0)`,
        `  if [ "$n" -lt 2 ]; then echo $((n + 1)) > ${JSON.stringify(counter)}; echo "fatal: unable to stat 'gone': No such file or directory" >&2; exit 128; fi`,
        "fi; done",
        `exec ${JSON.stringify(realGit)} "$@"`,
        "",
      ].join("\n"),
    );
    fs.chmodSync(path.join(shimDir, "git"), 0o755);
    try {
      const script = `
        import { diffUntrackedFiles } from ${JSON.stringify(path.join(import.meta.dir, "utils.ts"))};
        console.log(JSON.stringify(await diffUntrackedFiles(${JSON.stringify(root)})));
      `;
      const proc = Bun.spawnSync(["bun", "-e", script], {
        env: { ...process.env, PATH: `${shimDir}:${process.env.PATH}` },
        stdout: "pipe",
        stderr: "pipe",
      });
      const out = new TextDecoder().decode(proc.stdout).trim();
      expect(out).not.toBe("");
      expect(JSON.parse(out.split("\n").at(-1)!)).toBe(await perFileDiff(root, ["a.txt", "b.txt"]));
      expect(fs.readFileSync(counter, "utf8").trim()).toBe("2");
    } finally {
      fs.rmSync(shimDir, { recursive: true, force: true });
    }
  });
});

describe("withoutGitlinks", () => {
  const added = "diff --git a/a.txt b/a.txt\nnew file mode 100644\nindex 0000000..7898192\n--- /dev/null\n+++ b/a.txt\n@@ -0,0 +1 @@\n+a\n";
  const gitlink = "diff --git a/nested b/nested\nnew file mode 160000\nindex 0000000..e443f1f\n--- /dev/null\n+++ b/nested\n@@ -0,0 +1 @@\n+Subproject commit e443f1f06e4aad7df177e32c18acd7942f2a5eda\n";

  test("drops a nested repository's gitlink section, wherever it falls", () => {
    expect(withoutGitlinks(added + gitlink)).toBe(added);
    expect(withoutGitlinks(gitlink + added)).toBe(added);
    expect(withoutGitlinks(gitlink)).toBe("");
  });

  test("leaves a diff with no gitlink exactly as it was", () => {
    // Including one whose *content* is a patch: every content line is
    // prefixed, so a header inside a file cannot start a section.
    const patchFile = "diff --git a/p.patch b/p.patch\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/p.patch\n@@ -0,0 +1,2 @@\n+diff --git a/x b/x\n+new file mode 160000\n";
    expect(withoutGitlinks(added + patchFile)).toBe(added + patchFile);
  });
});

describe("settledStages", () => {
  test("one stage-0 record per unmerged path, from whichever stage came first", () => {
    const nul = (...records: string[]) => records.map((r) => `${r}\0`).join("");
    const listed = nul(
      "100644 df967b9 1\tc.txt",
      "100644 ba2906d 2\tc.txt",
      "100644 e45c9c2 3\tc.txt",
      "100755 aaaaaaa 1\tdir/run.sh",
      "100755 bbbbbbb 3\tdir/run.sh",
    );
    expect(settledStages(listed)).toBe(nul("100644 df967b9 0\tc.txt", "100755 aaaaaaa 0\tdir/run.sh"));
  });

  test("nothing unmerged is nothing to write", () => {
    expect(settledStages("")).toBe("");
  });
});

describe("mapWithConcurrency", () => {
  test("keeps at most the limit in flight and returns results in input order", async () => {
    let live = 0;
    let peak = 0;
    const results = await mapWithConcurrency([5, 1, 4, 2, 3, 6, 0], 3, async (n) => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, n * 2));
      live--;
      return n * 10;
    });
    expect(results).toEqual([50, 10, 40, 20, 30, 60, 0]);
    expect(peak).toBe(3);
  });

  test("an empty input resolves to an empty list", async () => {
    expect(await mapWithConcurrency<number, number>([], 4, async (n) => n)).toEqual([]);
  });
});

describe("coalesce", () => {
  /** A `fn` whose runs are released by hand, numbered in order of starting. */
  function controlled() {
    const releases: (() => void)[] = [];
    const fn = () =>
      new Promise<number>((resolve) => {
        const n = releases.length + 1;
        releases.push(() => resolve(n));
      });
    return { fn, runs: () => releases.length, release: (n: number) => releases[n - 1]!() };
  }

  test("callers arriving mid-run share one rerun after it, and get that run's answer", async () => {
    const { fn, runs, release } = controlled();

    const first = coalesce("k", fn);
    const late = coalesce("k", fn);
    const later = coalesce("k", fn);
    expect(runs()).toBe(1);

    release(1);
    expect(await first).toBe(1);
    // The rerun starts as the first settles, once for both late callers.
    await Bun.sleep(0);
    expect(runs()).toBe(2);
    release(2);
    expect(await late).toBe(2);
    expect(await later).toBe(2);

    // Nothing in flight: a fresh run, not a third.
    const next = coalesce("k", fn);
    expect(runs()).toBe(3);
    release(3);
    expect(await next).toBe(3);
  });

  test("a caller arriving during the rerun queues the one after it", async () => {
    const { fn, runs, release } = controlled();

    const first = coalesce("q", fn);
    const second = coalesce("q", fn);
    release(1);
    await first;
    await Bun.sleep(0);
    expect(runs()).toBe(2);

    const third = coalesce("q", fn);
    expect(runs()).toBe(2);
    release(2);
    expect(await second).toBe(2);
    await Bun.sleep(0);
    expect(runs()).toBe(3);
    release(3);
    expect(await third).toBe(3);
  });

  test("a rejection reaches its own callers only; the rerun still happens", async () => {
    let calls = 0;
    const fn = () => {
      calls++;
      return calls === 1 ? Promise.reject(new Error("no")) : Promise.resolve("ok");
    };
    const a = coalesce("fail", fn);
    const b = coalesce("fail", fn);
    await expect(a).rejects.toThrow("no");
    expect(await b).toBe("ok");
    expect(calls).toBe(2);

    expect(await coalesce("fail", async () => "again")).toBe("again");
  });

  test("keys are independent", async () => {
    const [x, y] = await Promise.all([coalesce("x", async () => 1), coalesce("y", async () => 2)]);
    expect([x, y]).toEqual([1, 2]);
  });
});
