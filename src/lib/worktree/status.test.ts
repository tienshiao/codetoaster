import { test, expect, describe, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { gitSpawn } from "../../api/utils";
import { deleteBranch } from "./branch";
import { branchIsExpendable, branchStatus } from "./status";

// The pre-archive read (docs/v2-architecture.md §5.6), against real
// repositories rather than a stubbed git. Every answer here is a claim about
// what git does — that `--not --remotes` collapses to the whole history when
// there is no remote, that `--contains` over `refs/remotes/` sees a pushed tip
// without an upstream configured — and a stub would only assert that we believe
// those things.

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

async function git(dir: string, ...args: string[]): Promise<string> {
  const { stdout, stderr, exitCode } = await gitSpawn(dir, args, { captureStderr: true });
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  return stdout.trim();
}

function tempDir(tag: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `codetoaster-status-${tag}-`));
  tempDirs.push(dir);
  return dir;
}

/** A repository on `main` with one commit.
 *
 * The identity is configured per repo rather than left to the machine's:
 * `user.useConfigOnly = true` is a real setting and `git commit` fails outright
 * under it, which would make this suite pass or fail on whose laptop it ran on.
 */
async function tempRepo(): Promise<string> {
  const root = tempDir("repo");
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.email", "t@example.com");
  await git(root, "config", "user.name", "T");
  fs.writeFileSync(path.join(root, "README.md"), "main\n");
  await git(root, "add", "-A");
  await git(root, "commit", "-m", "first");
  return root;
}

/** `n` commits on a new branch off `main`, made without leaving `main`. */
async function branchWithCommits(root: string, branch: string, n: number): Promise<void> {
  await git(root, "checkout", "-b", branch);
  for (let i = 0; i < n; i++) {
    fs.writeFileSync(path.join(root, `f${i}.txt`), `${i}\n`);
    await git(root, "add", "-A");
    await git(root, "commit", "-m", `c${i}`);
  }
  await git(root, "checkout", "main");
}

describe("branchStatus", () => {
  test("a branch already in main is merged and expendable", async () => {
    const root = await tempRepo();
    await git(root, "branch", "codetoaster/done");

    const status = await branchStatus(root, {
      branch: "codetoaster/done",
      baseRef: "main",
      worktreePath: null,
    });

    expect(status.exists).toBe(true);
    expect(status.merged).toBe(true);
    expect(status.pushed).toBe(false);
    expect(status.unpushed).toBe(0);
    expect(branchIsExpendable(status)).toBe(true);
    // Nothing has happened on it, which is what keeps the card's 'archive?'
    // nudge off a task that has only just been created — `merged` alone cannot
    // say, because `merge-base --is-ancestor` is reflexive.
    expect(status.atBase).toBe(true);
  });

  test("a branch merged into a base that has moved on is not at its base", async () => {
    const root = await tempRepo();
    await branchWithCommits(root, "codetoaster/landed", 1);
    // A merge commit, so `main` ends up ahead of the branch rather than on it —
    // the ordinary shape of work that landed.
    await git(root, "merge", "--no-ff", "-m", "merge", "codetoaster/landed");

    const status = await branchStatus(root, {
      branch: "codetoaster/landed",
      baseRef: "main",
      worktreePath: null,
    });

    expect(status.merged).toBe(true);
    expect(status.atBase).toBe(false);
  });

  test("an unresolvable base ref leaves atBase false rather than guessing", async () => {
    const root = await tempRepo();
    await git(root, "branch", "codetoaster/orphan");

    const status = await branchStatus(root, {
      branch: "codetoaster/orphan",
      baseRef: "refs/heads/gone",
      worktreePath: null,
    });

    expect(status.atBase).toBe(false);
  });

  test("commits not in the base ref and not on a remote are counted and keep the branch", async () => {
    const root = await tempRepo();
    await branchWithCommits(root, "codetoaster/wip", 2);

    const status = await branchStatus(root, {
      branch: "codetoaster/wip",
      baseRef: "main",
      worktreePath: null,
    });

    expect(status.unpushed).toBe(2);
    expect(status.merged).toBe(false);
    expect(status.pushed).toBe(false);
    expect(branchIsExpendable(status)).toBe(false);
  });

  test("a branch on a remote is expendable even with no upstream configured", async () => {
    const root = await tempRepo();
    await branchWithCommits(root, "codetoaster/shipped", 2);
    const remote = tempDir("remote");
    await git(remote, "init", "--bare", "-b", "main");
    await git(root, "remote", "add", "origin", remote);
    // Deliberately no `-u`: this is how a branch reaches a remote in practice
    // here, and an upstream comparison would call it unpushed.
    await git(root, "push", "origin", "codetoaster/shipped");
    await git(root, "fetch", "origin");

    const status = await branchStatus(root, {
      branch: "codetoaster/shipped",
      baseRef: "main",
      worktreePath: null,
    });

    expect(status.pushed).toBe(true);
    expect(status.unpushed).toBe(0);
    expect(status.merged).toBe(false);
    expect(branchIsExpendable(status)).toBe(true);
  });

  test("with no base ref the count degrades to everything not on a remote", async () => {
    const root = await tempRepo();
    await branchWithCommits(root, "codetoaster/unbounded", 2);

    const status = await branchStatus(root, {
      branch: "codetoaster/unbounded",
      baseRef: null,
      worktreePath: null,
    });

    // Three, not two: the branch's own two commits plus `main`'s initial one.
    // Nothing bounds the walk once `--remotes` expands to nothing, and the
    // documented contract is that this over-reports rather than pretending to
    // a bound it does not have.
    expect(status.unpushed).toBe(3);
    expect(status.merged).toBe(false);
    expect(branchIsExpendable(status)).toBe(false);
  });

  test("a base ref that no longer resolves is treated as no base ref", async () => {
    const root = await tempRepo();
    await branchWithCommits(root, "codetoaster/orphaned-base", 2);

    const status = await branchStatus(root, {
      branch: "codetoaster/orphaned-base",
      baseRef: "codetoaster/deleted-long-ago",
      worktreePath: null,
    });

    expect(status.unpushed).toBe(3);
    expect(status.merged).toBe(false);
  });

  test("a checkout's modifications and untracked files both count as dirt", async () => {
    const root = await tempRepo();
    await git(root, "branch", "codetoaster/dirty");
    const checkout = path.join(tempDir("wt"), "tree");
    await git(root, "worktree", "add", checkout, "codetoaster/dirty");
    fs.writeFileSync(path.join(checkout, "README.md"), "changed\n");
    fs.writeFileSync(path.join(checkout, "scratch.txt"), "untracked\n");

    const status = await branchStatus(root, {
      branch: "codetoaster/dirty",
      baseRef: "main",
      worktreePath: checkout,
    });

    expect(status.dirty).toBe(2);
  });

  test("a clean checkout counts zero", async () => {
    const root = await tempRepo();
    await git(root, "branch", "codetoaster/clean");
    const checkout = path.join(tempDir("wt"), "tree");
    await git(root, "worktree", "add", checkout, "codetoaster/clean");

    const status = await branchStatus(root, {
      branch: "codetoaster/clean",
      baseRef: "main",
      worktreePath: checkout,
    });

    expect(status.dirty).toBe(0);
  });

  test("no checkout is `null` dirt, not zero", async () => {
    const root = await tempRepo();
    await git(root, "branch", "codetoaster/evicted");

    const absent = await branchStatus(root, {
      branch: "codetoaster/evicted",
      baseRef: "main",
      worktreePath: null,
    });
    const gone = await branchStatus(root, {
      branch: "codetoaster/evicted",
      baseRef: "main",
      worktreePath: path.join(root, "no", "such", "tree"),
    });

    expect(absent.dirty).toBeNull();
    expect(gone.dirty).toBeNull();
  });

  test("a branch that is not there is expendable, and its checkout is still counted", async () => {
    const root = await tempRepo();
    // A directory that is a checkout of the repository but not of the branch
    // being asked about — the state left by someone deleting a task's branch by
    // hand. The dirt is still real and still about to be destroyed.
    const checkout = path.join(tempDir("wt"), "tree");
    await git(root, "worktree", "add", "--detach", checkout, "main");
    fs.writeFileSync(path.join(checkout, "scratch.txt"), "untracked\n");

    const status = await branchStatus(root, {
      branch: "codetoaster/never-existed",
      baseRef: "main",
      worktreePath: checkout,
    });

    expect(status.exists).toBe(false);
    expect(status.unpushed).toBe(0);
    expect(status.merged).toBe(false);
    expect(status.pushed).toBe(false);
    expect(status.dirty).toBe(1);
    expect(branchIsExpendable(status)).toBe(true);
  });
});

describe("deleteBranch", () => {
  test("removes a branch that still has unmerged commits", async () => {
    const root = await tempRepo();
    await branchWithCommits(root, "codetoaster/gone", 2);

    expect(await deleteBranch(root, "codetoaster/gone")).toBe(true);

    const after = await branchStatus(root, {
      branch: "codetoaster/gone",
      baseRef: "main",
      worktreePath: null,
    });
    expect(after.exists).toBe(false);
  });

  test("answers true for a branch that was never there", async () => {
    const root = await tempRepo();
    expect(await deleteBranch(root, "codetoaster/never-existed")).toBe(true);
  });

  test("leaves the remote's copy alone", async () => {
    const root = await tempRepo();
    await branchWithCommits(root, "codetoaster/shipped", 1);
    const remote = tempDir("remote");
    await git(remote, "init", "--bare", "-b", "main");
    await git(root, "remote", "add", "origin", remote);
    await git(root, "push", "origin", "codetoaster/shipped");
    await git(root, "fetch", "origin");

    expect(await deleteBranch(root, "codetoaster/shipped")).toBe(true);

    const remoteRefs = await git(root, "for-each-ref", "--format=%(refname)", "refs/remotes/");
    expect(remoteRefs).toContain("refs/remotes/origin/codetoaster/shipped");
  });
});
