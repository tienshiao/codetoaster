import { test, expect, describe, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  TaskWatcher,
  isHistoryPath,
  isReportableCheckoutPath,
  startTaskWatcher,
  watchRootsFor,
  type ChangeBatch,
} from "./watcher";
import { git } from "../../../test/git-repo";
import { waitFor } from "../../../test/wait";

// Real directories and real events, because the thing under test is what the
// platform delivers and how it is folded — a fake emitter would only prove the
// fold against itself. The timings are short and the waits generous: FSEvents
// delivers within a few hundred milliseconds on a quiet machine and later on a
// loaded one.
const SETTLE = 150;
const CAP = 600;

const dirs: string[] = [];
const watchers: { close(): void }[] = [];

// Real, not symlinked: macOS's tmpdir is `/var/...` for `/private/var/...`,
// and git answers in the latter.
function tmp(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `codetoaster-${prefix}-`)));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const w of watchers.splice(0)) w.close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

// The pause before the watch is not politeness. FSEvents starts a stream
// "since now" with a latency window, and delivers the fixture directories
// created a few milliseconds earlier as the stream's first events — which the
// watcher would rightly report. The pause after is for the stream to be up
// before the test writes anything.
async function watching(roots: { checkout: string; gitDirs: string[] }, options = {}) {
  await Bun.sleep(300);
  const batches: ChangeBatch[] = [];
  const watcher = new TaskWatcher(roots, (b) => batches.push(b), {
    settleMs: SETTLE,
    maxWaitMs: CAP,
    ...options,
  });
  watchers.push(watcher);
  await Bun.sleep(100);
  return { watcher, batches };
}

describe("classification", () => {
  test("checkout paths: the user's files, and nothing under .git, node_modules or other worktrees", () => {
    expect(isReportableCheckoutPath("src/a.ts")).toBe(true);
    expect(isReportableCheckoutPath("deep/er/file")).toBe(true);
    expect(isReportableCheckoutPath(".gitignore")).toBe(true);
    expect(isReportableCheckoutPath("")).toBe(false);
    expect(isReportableCheckoutPath(".git/HEAD")).toBe(false);
    expect(isReportableCheckoutPath("vendor/.git/index")).toBe(false);
    expect(isReportableCheckoutPath("node_modules/x/index.js")).toBe(false);
    expect(isReportableCheckoutPath("pkg/node_modules/x")).toBe(false);
    expect(isReportableCheckoutPath(".claude/worktrees/other/src/a.ts")).toBe(false);
    expect(isReportableCheckoutPath(".claude/settings.json")).toBe(true);
  });

  test("metadata paths: HEAD and refs are history; objects, logs, index and locks are not", () => {
    expect(isHistoryPath("HEAD")).toBe(true);
    expect(isHistoryPath("ORIG_HEAD")).toBe(true);
    expect(isHistoryPath("packed-refs")).toBe(true);
    expect(isHistoryPath("refs/heads/main")).toBe(true);
    expect(isHistoryPath("refs/remotes/origin/main")).toBe(true);
    expect(isHistoryPath("refs")).toBe(true);
    expect(isHistoryPath("HEAD.lock")).toBe(false);
    expect(isHistoryPath("refs/heads/main.lock")).toBe(false);
    expect(isHistoryPath("objects/ab/cdef")).toBe(false);
    expect(isHistoryPath("logs/HEAD")).toBe(false);
    expect(isHistoryPath("index")).toBe(false);
    expect(isHistoryPath("worktrees/other/HEAD")).toBe(false);
    expect(isHistoryPath("")).toBe(false);
  });
});

describe("TaskWatcher", () => {
  test("a burst of edits is one batch, naming the files", async () => {
    const checkout = tmp("watch");
    fs.mkdirSync(path.join(checkout, "src"));
    const { batches } = await watching({ checkout, gitDirs: [] });
    await Bun.sleep(100);

    fs.writeFileSync(path.join(checkout, "src", "a.ts"), "a");
    fs.writeFileSync(path.join(checkout, "src", "b.ts"), "b");
    fs.writeFileSync(path.join(checkout, "src", "a.ts"), "aa");

    expect(await waitFor(() => batches.length > 0, 3000)).toBe(true);
    // Settled, so nothing else arrives for the same burst.
    await Bun.sleep(SETTLE * 3);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual({ files: ["src/a.ts", "src/b.ts"], history: false });
  });

  test("a file in a directory created after the watch started is seen", async () => {
    const checkout = tmp("watch-newdir");
    const { batches } = await watching({ checkout, gitDirs: [] });
    await Bun.sleep(100);

    fs.mkdirSync(path.join(checkout, "later", "nested"), { recursive: true });
    fs.writeFileSync(path.join(checkout, "later", "nested", "x.txt"), "x");

    const seen = () => batches.some((b) => b.files?.includes("later/nested/x.txt"));
    expect(await waitFor(seen, 3000)).toBe(true);
  });

  test("ignored paths produce no batch at all", async () => {
    const checkout = tmp("watch-ignored");
    fs.mkdirSync(path.join(checkout, "node_modules", "dep"), { recursive: true });
    fs.mkdirSync(path.join(checkout, ".git", "refs"), { recursive: true });
    const { batches } = await watching({ checkout, gitDirs: [] });
    await Bun.sleep(100);

    fs.writeFileSync(path.join(checkout, "node_modules", "dep", "index.js"), "x");
    fs.writeFileSync(path.join(checkout, ".git", "HEAD"), "ref: refs/heads/main");
    await Bun.sleep(CAP + SETTLE * 2);
    expect(batches).toEqual([]);
  });

  test("a stream that never settles still flushes at the cap", async () => {
    const checkout = tmp("watch-stream");
    const { batches } = await watching({ checkout, gitDirs: [] });
    await Bun.sleep(100);

    // Writes every 20ms for three caps' worth: the settle timer never fires on
    // its own, so anything reported before the stream ends is the cap's doing.
    const stop = Date.now() + CAP * 3;
    let i = 0;
    while (Date.now() < stop) {
      fs.writeFileSync(path.join(checkout, `f${i++ % 5}.txt`), String(i));
      await Bun.sleep(20);
    }
    expect(batches.length).toBeGreaterThanOrEqual(2);
    for (const batch of batches) expect(batch.files?.length ?? 0).toBeGreaterThan(0);
  });

  test("more files than the cap collapses the list to null", async () => {
    const checkout = tmp("watch-overflow");
    const { batches } = await watching({ checkout, gitDirs: [] }, { maxFiles: 5 });
    await Bun.sleep(100);

    for (let i = 0; i < 12; i++) fs.writeFileSync(path.join(checkout, `f${i}.txt`), "x");

    expect(await waitFor(() => batches.length > 0, 3000)).toBe(true);
    expect(batches[0]!.files).toBeNull();
    expect(batches[0]!.history).toBe(false);
  });

  test("a ref moving under a metadata root is history, and files stay empty", async () => {
    const checkout = tmp("watch-history");
    const meta = tmp("watch-meta");
    fs.mkdirSync(path.join(meta, "refs", "heads"), { recursive: true });
    fs.mkdirSync(path.join(meta, "objects", "ab"), { recursive: true });
    const { batches } = await watching({ checkout, gitDirs: [meta] });
    await Bun.sleep(100);

    // Objects first, alone: nothing to say yet.
    fs.writeFileSync(path.join(meta, "objects", "ab", "cdef"), "blob");
    fs.writeFileSync(path.join(meta, "index"), "index");
    await Bun.sleep(CAP + SETTLE * 2);
    expect(batches).toEqual([]);

    // Then the ref, the way git does it: a lock renamed over the real name.
    fs.writeFileSync(path.join(meta, "refs", "heads", "main.lock"), "sha");
    fs.renameSync(path.join(meta, "refs", "heads", "main.lock"), path.join(meta, "refs", "heads", "main"));

    expect(await waitFor(() => batches.length > 0, 3000)).toBe(true);
    expect(batches[0]).toEqual({ files: [], history: true });
  });

  test("an edit and a commit in one burst report both", async () => {
    const checkout = tmp("watch-both");
    const meta = tmp("watch-both-meta");
    const { batches } = await watching({ checkout, gitDirs: [meta] });
    await Bun.sleep(100);

    fs.writeFileSync(path.join(checkout, "a.txt"), "a");
    fs.writeFileSync(path.join(meta, "HEAD"), "sha");

    expect(await waitFor(() => batches.length > 0, 3000)).toBe(true);
    await Bun.sleep(SETTLE * 3);
    expect(batches).toEqual([{ files: ["a.txt"], history: true }]);
  });

  // A real repository, because what is under test is git's answer about the
  // paths and not a rule reimplemented here.
  async function ignoringDist(prefix: string): Promise<string> {
    const repo = tmp(prefix);
    await git(repo, "init", "-q");
    fs.writeFileSync(path.join(repo, ".gitignore"), "dist/\n");
    fs.mkdirSync(path.join(repo, "dist"));
    fs.mkdirSync(path.join(repo, "src"));
    return repo;
  }

  test("an ignored path is dropped and the edit beside it still reported", async () => {
    const repo = await ignoringDist("watch-ignore");
    const { batches } = await watching({ checkout: repo, gitDirs: [path.join(repo, ".git")] });
    await Bun.sleep(100);

    // A build and an edit in the same burst, which is what a watch task does
    // to itself: the tree, the diff and the search are all
    // `--exclude-standard`, so `dist/out.js` would invalidate three queries for
    // content none of them can show.
    fs.writeFileSync(path.join(repo, "dist", "out.js"), "built");
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "a");

    expect(await waitFor(() => batches.length > 0, 3000)).toBe(true);
    await Bun.sleep(SETTLE * 3);
    expect(batches).toEqual([{ files: ["src/a.ts"], history: false }]);
  });

  test("a burst that is entirely ignored says nothing at all", async () => {
    const repo = await ignoringDist("watch-ignore-all");
    const { batches } = await watching({ checkout: repo, gitDirs: [path.join(repo, ".git")] });
    await Bun.sleep(100);

    // The whole of a build, and the point of the filter: an empty file list
    // with nothing else to report is not a batch worth sending.
    for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(repo, "dist", `out${i}.js`), "built");
    await Bun.sleep(CAP + SETTLE * 4);
    expect(batches).toEqual([]);
  });

  test("close stops delivery and drops what was pending", async () => {
    const checkout = tmp("watch-close");
    const { watcher, batches } = await watching({ checkout, gitDirs: [] });
    await Bun.sleep(100);

    fs.writeFileSync(path.join(checkout, "a.txt"), "a");
    watcher.close();
    watcher.close();
    fs.writeFileSync(path.join(checkout, "b.txt"), "b");
    await Bun.sleep(CAP + SETTLE * 2);
    expect(batches).toEqual([]);
  });

  test("a root that does not exist refuses to construct, and opens nothing", () => {
    const checkout = tmp("watch-missing");
    const batches: ChangeBatch[] = [];
    expect(
      () =>
        new TaskWatcher(
          { checkout, gitDirs: [path.join(checkout, "absent")] },
          (b) => batches.push(b),
        ),
    ).toThrow();
  });
});

describe("watchRootsFor", () => {
  test("a repository's own directory yields its .git", async () => {
    const repo = tmp("roots-repo");
    await git(repo, "init", "-q");
    const roots = await watchRootsFor(repo);
    expect(roots.checkout).toBe(repo);
    expect(roots.gitDirs).toEqual([path.join(repo, ".git")]);
  });

  test("a linked worktree yields its own metadata and the common dir", async () => {
    const repo = tmp("roots-main");
    await git(repo, "init", "-q");
    await git(
      repo, "-c", "user.email=t@t", "-c", "user.name=t",
      "commit", "--allow-empty", "-q", "-m", "root",
    );
    const linked = path.join(repo, "linked");
    await git(repo, "worktree", "add", "-q", linked, "-b", "side");
    const roots = await watchRootsFor(linked);
    expect(roots.gitDirs).toHaveLength(2);
    expect(roots.gitDirs).toContain(path.join(repo, ".git"));
    expect(roots.gitDirs.some((d) => d.startsWith(path.join(repo, ".git", "worktrees")))).toBe(true);
  });

  test("a directory that is not a repository yields only the checkout", async () => {
    const plain = tmp("roots-plain");
    expect(await watchRootsFor(plain)).toEqual({ checkout: plain, gitDirs: [] });
  });
});

describe("startTaskWatcher", () => {
  test("stop before the roots are known cancels the start", async () => {
    const plain = tmp("start-cancel");
    const batches: ChangeBatch[] = [];
    const handle = startTaskWatcher(plain, (b) => batches.push(b), { settleMs: SETTLE, maxWaitMs: CAP });
    handle.stop();
    expect(await handle.ready).toBe(false);
    fs.writeFileSync(path.join(plain, "a.txt"), "a");
    await Bun.sleep(CAP + SETTLE * 2);
    expect(batches).toEqual([]);
  });

  test("a started watcher reports, and stop ends it", async () => {
    const plain = tmp("start-run");
    const batches: ChangeBatch[] = [];
    const handle = startTaskWatcher(plain, (b) => batches.push(b), { settleMs: SETTLE, maxWaitMs: CAP });
    watchers.push({ close: () => handle.stop() });
    expect(await handle.ready).toBe(true);
    await Bun.sleep(100);
    fs.writeFileSync(path.join(plain, "a.txt"), "a");
    expect(await waitFor(() => batches.length === 1, 3000)).toBe(true);
    handle.stop();
    fs.writeFileSync(path.join(plain, "b.txt"), "b");
    await Bun.sleep(CAP + SETTLE * 2);
    expect(batches).toHaveLength(1);
  });

  test("a checkout that has gone is reported once, not thrown", async () => {
    const gone = path.join(os.tmpdir(), `codetoaster-start-gone-${crypto.randomUUID()}`);
    const errors: Error[] = [];
    const handle = startTaskWatcher(gone, () => {}, { onError: (e) => errors.push(e) });
    expect(await handle.ready).toBe(false);
    expect(errors).toHaveLength(1);
  });
});
