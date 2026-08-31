import { test, expect, describe, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { cleanupRepos, git, tempDir, tempProject, tempRepo, tempTask } from "../../../test/git-repo";
import { allocateBranch } from "./branch";
import { createWorktree } from "./create";
import { WorktreeError } from "./errors";
import { worktreePathFor } from "./paths";

afterEach(cleanupRepos);

const project = tempProject;
const task = tempTask;

describe("createWorktree", () => {
  test("puts a checkout of the base ref at the task's id-derived path", async () => {
    const { root, otherSha } = await tempRepo();
    const p = project(root);
    const t = task("Fix the parser");

    const created = await createWorktree(p, t, "other");

    expect(created.worktreePath).toBe(worktreePathFor(p.id, t.id));
    expect(created.branch).toBe("codetoaster/fix-the-parser");
    // A real checkout of the ref that was asked for, not of whatever HEAD was:
    // the repository sits on `main` and the base ref was `other`.
    expect(await git(created.worktreePath, "rev-parse", "HEAD")).toBe(otherSha);
    expect(await git(created.worktreePath, "rev-parse", "--abbrev-ref", "HEAD"))
      .toBe("codetoaster/fix-the-parser");
    expect(fs.readFileSync(path.join(created.worktreePath, "README.md"), "utf8")).toBe("on other\n");
    // And the repository knows about it, so evict and reconcile have something
    // to list.
    expect(await git(root, "worktree", "list", "--porcelain")).toContain(created.worktreePath);
  });

  // The constraint the resume path rests on. Claude Code files a conversation's
  // transcript under the escaped cwd, so a path that followed the title would
  // strand every transcript at the old one the moment a task was renamed —
  // `--resume` finding nothing and `--continue` looking in an empty directory.
  // Evict and restore need the same fixity for the same reason.
  test("does not move when the task is renamed", async () => {
    const { root } = await tempRepo();
    const p = project(root);
    const t = task("First name");

    const before = await createWorktree(p, t, "main");
    const after = worktreePathFor(p.id, { ...t, title: "Something else entirely" }.id);

    expect(after).toBe(before.worktreePath);
    // Only the branch carried the title, and it keeps the name it was made
    // with — renaming a task is cosmetic, and rewriting a branch under a
    // running checkout would be anything but.
    expect(before.branch).toBe("codetoaster/first-name");
  });

  test("suffixes a branch name that is already taken", async () => {
    const { root } = await tempRepo();
    const p = project(root);

    const first = await createWorktree(p, task("Same title"), "main");
    const second = await createWorktree(p, task("Same title"), "main");
    const third = await createWorktree(p, task("Same title"), "main");

    // From 2, so the first task to want a name gets the bare one.
    expect([first.branch, second.branch, third.branch]).toEqual([
      "codetoaster/same-title",
      "codetoaster/same-title-2",
      "codetoaster/same-title-3",
    ]);
  });

  // AC #3, and the reason `withRepoLock` exists. Choosing a suffix means
  // listing the branches and taking the first free one, so N creates that all
  // list before any of them writes all choose the same name: one add succeeds
  // and the rest fail on a branch that exists by the time they look again.
  test("N parallel creates in one repository each get their own branch", async () => {
    const { root } = await tempRepo();
    const p = project(root);
    const tasks = Array.from({ length: 6 }, () => task("Race"));

    const created = await Promise.all(tasks.map((t) => createWorktree(p, t, "main")));

    const branches = created.map((c) => c.branch);
    expect(new Set(branches).size).toBe(6);
    expect([...branches].sort()).toEqual([
      "codetoaster/race",
      "codetoaster/race-2",
      "codetoaster/race-3",
      "codetoaster/race-4",
      "codetoaster/race-5",
      "codetoaster/race-6",
    ]);
    // Every one of them is a real checkout, not just a name that was reserved.
    for (const c of created) {
      expect(await git(c.worktreePath, "rev-parse", "--abbrev-ref", "HEAD")).toBe(c.branch);
    }
  });

  // `%(refname:short)` means "as short as is unambiguous", so a repository
  // that also holds a *tag* of the branch's name gets `heads/codetoaster/x`
  // back for the branch. The set of taken names would then not contain the
  // name being tested, and the create would be handed a branch that exists.
  test("sees a branch whose name a tag also claims", async () => {
    const { root } = await tempRepo();
    await git(root, "branch", "codetoaster/taken");
    await git(root, "tag", "codetoaster/taken");

    expect(await allocateBranch(root, task("Taken"))).toBe("codetoaster/taken-2");
  });

  // What an eviction that reclaimed the disk (§5.6) leaves, and what a user
  // with `rm -rf` leaves: `.git/worktrees` still has the registration and the
  // directory is gone. Plain `worktree add` refuses that outright — and the
  // task's path is fixed by its id and cannot be moved away from, so refusing
  // would poison it for good.
  test("reclaims a path git still has registered but nothing is at", async () => {
    const { root } = await tempRepo();
    const p = project(root);
    const t = task("Evicted");

    const first = await createWorktree(p, t, "main");
    fs.rmSync(first.worktreePath, { recursive: true, force: true });
    // Still registered: only the checkout went.
    expect(await git(root, "worktree", "list", "--porcelain")).toContain(first.worktreePath);

    const again = await createWorktree(p, t, "main");

    expect(again.worktreePath).toBe(first.worktreePath);
    expect(fs.existsSync(path.join(again.worktreePath, "README.md"))).toBe(true);
    expect(await git(again.worktreePath, "rev-parse", "--abbrev-ref", "HEAD")).toBe(again.branch);
  });

  // The lock is keyed on the repository, and `--show-toplevel` does not name
  // one: it names a *worktree*. A project whose directory is itself a linked
  // worktree of the same repository would take a different lock from one
  // pointing at the main checkout — while sharing `.git/worktrees` and the ref
  // store, so both creates read the branch list and allocate the same name.
  test("serializes two projects that are different checkouts of one repository", async () => {
    const { root } = await tempRepo();
    const linked = tempDir("codetoaster-linked-");
    // git insists on creating the worktree directory itself.
    fs.rmSync(linked, { recursive: true, force: true });
    await git(root, "worktree", "add", "-b", "a-linked-checkout", linked, "main");

    const fromMain = project(root);
    const fromLinked = project(linked);

    const [a, b] = await Promise.all([
      createWorktree(fromMain, task("Shared name"), "main"),
      createWorktree(fromLinked, task("Shared name"), "main"),
    ]);

    expect(a.branch).not.toBe(b.branch);
    expect([a.branch, b.branch].sort())
      .toEqual(["codetoaster/shared-name", "codetoaster/shared-name-2"]);
  });

  test("copies the project's ignored files into the new checkout", async () => {
    const { root } = await tempRepo();
    fs.writeFileSync(path.join(root, ".env"), "SECRET=1\n");
    fs.mkdirSync(path.join(root, ".config"), { recursive: true });
    fs.writeFileSync(path.join(root, ".config", "local.json"), "{}\n");
    const p = project(root, { worktree_copy: ".env\n.config\nnot-there\n" });

    const created = await createWorktree(p, task("With env"), "main");

    expect(fs.readFileSync(path.join(created.worktreePath, ".env"), "utf8")).toBe("SECRET=1\n");
    // Directories too, recursively — an entry is not always a single dotfile.
    expect(fs.existsSync(path.join(created.worktreePath, ".config", "local.json"))).toBe(true);
    // A missing source is the ordinary case (a fresh clone with no .env), not
    // a broken project, so it is skipped rather than failing the create.
    expect(created.copied).toEqual([".env", ".config"]);
  });

  describe("failures carry a kind and git's own account of them", () => {
    test("a base ref that names nothing", async () => {
      const { root } = await tempRepo();
      const error = await createWorktree(project(root), task("Bad base"), "no-such-ref")
        .catch((e) => e);

      expect(error).toBeInstanceOf(WorktreeError);
      expect(error.kind).toBe("bad-base-ref");
      expect(error.message).toContain("no-such-ref");
    });

    test("a path that already holds something", async () => {
      const { root } = await tempRepo();
      const p = project(root);
      const t = task("Occupied");
      const occupied = worktreePathFor(p.id, t.id);
      fs.mkdirSync(occupied, { recursive: true });
      fs.writeFileSync(path.join(occupied, "leftover"), "x");

      const error = await createWorktree(p, t, "main").catch((e) => e);

      expect(error).toBeInstanceOf(WorktreeError);
      expect(error.kind).toBe("path-occupied");
    });

    // An empty directory is not "occupied": it is what a create interrupted
    // before git ran leaves behind, and the path is fixed by the task's id, so
    // refusing it would poison that task's only possible path for good.
    test("but an empty directory is not in the way", async () => {
      const { root } = await tempRepo();
      const p = project(root);
      const t = task("Empty dir");
      fs.mkdirSync(worktreePathFor(p.id, t.id), { recursive: true });

      const created = await createWorktree(p, t, "main");

      expect(created.branch).toBe("codetoaster/empty-dir");
    });

    test("a directory that is not a repository at all", async () => {
      const plain = tempDir("codetoaster-plain-");

      const error = await createWorktree(project(plain), task("No repo"), "main").catch((e) => e);

      expect(error).toBeInstanceOf(WorktreeError);
      expect(error.kind).toBe("not-a-repo");
    });

    // A create is all or nothing: a checkout the copy did not finish would run
    // the project's setup against a half-populated tree, and the task's path
    // cannot be moved away from, so the wreckage would be permanent.
    test("a copy that escapes the project leaves no worktree behind", async () => {
      const { root } = await tempRepo();
      const p = project(root, { worktree_copy: "../outside\n" });
      const t = task("Escapes");

      const error = await createWorktree(p, t, "main").catch((e) => e);

      expect(error).toBeInstanceOf(WorktreeError);
      expect(error.kind).toBe("copy-failed");
      expect(fs.existsSync(worktreePathFor(p.id, t.id))).toBe(false);
      expect(await git(root, "worktree", "list", "--porcelain"))
        .not.toContain(worktreePathFor(p.id, t.id));
      // The branch goes with it, or the next attempt at this task would be
      // suffixed around a branch nothing is using.
      expect(await git(root, "branch", "--list", "codetoaster/escapes")).toBe("");
    });
  });
});
