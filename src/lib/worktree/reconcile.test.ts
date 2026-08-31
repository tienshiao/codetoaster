import { test, expect, describe, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import {
  cleanupRepos,
  foreignCheckouts,
  git,
  tempProject,
  tempRepo,
  tempTask,
} from "../../../test/git-repo";
import { createWorktree } from "./create";
import { isWithinWorktreesRoot, worktreePathFor, worktreesRoot } from "./paths";
import { reconcileWorktrees } from "./reconcile";

// The boot sweep, against real repositories and the real worktrees root
// (docs/v2-architecture.md §5.6, TASK-32).
//
// Every test here is written around one asymmetry: the sweep deletes
// directories, and the two ways it can be wrong cost wildly different things.
// A checkout it wrongly spares is a directory the user removes by hand; a
// checkout it wrongly removes is uncommitted work nobody took a snapshot of.
// So the assertions come in pairs — what the report says, *and* what is still
// on disk — because a report that says the right thing about a directory it
// already deleted would pass a test that only read the report.

const strays: string[] = [];
const stayIfShared: string[] = [];

afterEach(() => {
  // Ours first, then everything the shared harness handed out. `strays` holds
  // the paths that are deliberately *outside* the worktrees root, which is the
  // one thing `cleanupRepos` cannot know about.
  for (const dir of strays.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  // And their containing directory, but only when this suite emptied it. These
  // are directories in the user's real home whose names we chose to be
  // confusable with ours, so a recursive delete of one would be the very
  // mistake the test that made it is checking for. `rmdir` refuses a directory
  // with anything in it, which is exactly the condition wanted.
  for (const dir of stayIfShared.splice(0)) {
    try {
      fs.rmdirSync(dir);
    } catch {
      // Not empty, or never created. Either way it is not ours to remove.
    }
  }
  cleanupRepos();
});

const project = tempProject;
const task = tempTask;

/** Run the sweep over a set of repositories, sparing everything on disk that
 * this suite did not put there.
 *
 * The `claimed` argument is only ever the *test's own* claims; the foreign
 * checkouts are added underneath every time, for the reason `foreignCheckouts`
 * spells out. Wrapping it here rather than repeating it per test is the point:
 * a test that forgot would not fail, it would delete somebody's work. */
async function sweep(repoRoots: string[], claimed: readonly string[] = []) {
  return reconcileWorktrees({
    repoRoots,
    claimed: new Set([...foreignCheckouts(), ...claimed.map((p) => path.resolve(p))]),
  });
}

describe("reconcileWorktrees", () => {
  // AC #1. "Clean" is about the working tree and nothing else, which is why the
  // branch assertion belongs here: a checkout with commits on its branch is
  // still clean, and the commits survive because `discardCheckout` removes the
  // directory and leaves the ref.
  test("removes a clean checkout no task claims, and says which", async () => {
    const { root } = await tempRepo();
    const created = await createWorktree(project(root), task("Orphaned"), "main");

    const report = await sweep([root]);

    expect(report.removed).toEqual([created.worktreePath]);
    expect(report.unclaimed).toEqual([]);
    expect(fs.existsSync(created.worktreePath)).toBe(false);
    // The registration went with the directory, not just the directory: one
    // left behind is what makes a repository accumulate worktrees nothing will
    // ever name again.
    expect(await git(root, "worktree", "list", "--porcelain"))
      .not.toContain(created.worktreePath);
    // And the branch is untouched. The sweep is a statement about disk usage,
    // never about history.
    expect(await git(root, "branch", "--list", created.branch)).toContain(created.branch);
  });

  // AC #2, and the rule the whole module is written to. However orphaned, a
  // checkout holding files is handed back for the user to decide about.
  test("never removes an orphan with uncommitted work in it", async () => {
    const { root } = await tempRepo();
    const created = await createWorktree(project(root), task("Left dirty"), "main");
    fs.writeFileSync(path.join(created.worktreePath, "scratch.txt"), "an hour of work\n");

    const report = await sweep([root]);

    expect(report.removed).toEqual([]);
    expect(report.unclaimed).toEqual([{
      path: created.worktreePath,
      repoRoot: root,
      branch: created.branch,
      dirty: 1,
    }]);
    // The card is only worth anything because the directory is still there.
    expect(fs.readFileSync(path.join(created.worktreePath, "scratch.txt"), "utf8"))
      .toBe("an hour of work\n");
    expect(await git(root, "worktree", "list", "--porcelain")).toContain(created.worktreePath);
  });

  test("leaves a checkout a task claims completely alone", async () => {
    const { root } = await tempRepo();
    const created = await createWorktree(project(root), task("Still in use"), "main");

    const report = await sweep([root], [created.worktreePath]);

    expect(report.removed).toEqual([]);
    // Not reported either: an unclaimed card is a question put to the user, and
    // a checkout with a task on it is not a question.
    expect(report.unclaimed).toEqual([]);
    expect(await git(created.worktreePath, "rev-parse", "--abbrev-ref", "HEAD"))
      .toBe(created.branch);
  });

  // The "we could not establish it holds nothing" branch, reached the ordinary
  // way: a directory under our root that git has never heard of. `dirtyCount`
  // answers null rather than 0, and null is what keeps it out of `removed` —
  // folding it into "clean" is the one mistake in this module that loses data.
  test("reports a directory that is not a checkout, and does not remove it", async () => {
    const { root } = await tempRepo();
    const p = project(root);
    const notACheckout = worktreePathFor(p.id, task("Never finished").id);
    fs.mkdirSync(notACheckout, { recursive: true });
    fs.writeFileSync(path.join(notACheckout, "half-copied.env"), "SECRET=1\n");

    const report = await sweep([root]);

    expect(report.removed).toEqual([]);
    expect(report.unclaimed).toEqual([{
      path: notACheckout,
      // Nothing to ask, so nothing is claimed: no repository, and therefore no
      // branch either — the card says "we do not know" rather than guessing.
      repoRoot: null,
      branch: null,
      dirty: null,
    }]);
    expect(fs.existsSync(path.join(notACheckout, "half-copied.env"))).toBe(true);
  });

  // The commonest way a repository ends up with a registration for a directory
  // that is not there: somebody ran `rm -rf` between two daemon runs. The
  // registration is invisible to the user and blocks nothing, but it is exactly
  // what `worktree add` refuses to reuse, so leaving it poisons the one path
  // that task can ever have.
  test("prunes registrations whose directories are gone, with nothing to remove", async () => {
    const { root } = await tempRepo();
    const created = await createWorktree(project(root), task("Deleted by hand"), "main");
    fs.rmSync(created.worktreePath, { recursive: true, force: true });
    expect(await git(root, "worktree", "list", "--porcelain")).toContain(created.worktreePath);

    const report = await sweep([root]);

    // Nothing was on disk to act on — which is the point: the prune is not a
    // side effect of a removal, it happens for a repository the sweep had no
    // removals in at all.
    expect(report.removed).toEqual([]);
    expect(report.unclaimed).toEqual([]);
    expect(await git(root, "worktree", "list", "--porcelain"))
      .not.toContain(created.worktreePath);
  });

  // AC #4. `worktrees-backup` shares every character of the root's name and is
  // not inside it, which is why the guard is `path.relative` and not a prefix
  // test — and the sweep is *handed* one of these, through the repository's own
  // worktree list, rather than being trusted to never meet one.
  test("does not touch a checkout outside the worktrees root", async () => {
    const { root } = await tempRepo();
    const p = project(root);
    const backupRoot = `${worktreesRoot()}-backup`;
    // Only what this test made comes back off the disk. The directory is in the
    // user's real home, so removing it wholesale on the assumption that nothing
    // else could ever live there is exactly the reasoning under test.
    strays.push(path.join(backupRoot, p.id));
    stayIfShared.push(backupRoot);
    const outside = path.join(backupRoot, p.id, task("Outside").id);
    fs.mkdirSync(path.dirname(outside), { recursive: true });
    await git(root, "worktree", "add", "-b", "codetoaster/outside", outside, "main");

    expect(isWithinWorktreesRoot(worktreesRoot())).toBe(true);
    expect(isWithinWorktreesRoot(backupRoot)).toBe(false);
    expect(isWithinWorktreesRoot(outside)).toBe(false);

    const report = await sweep([root]);

    // The repository lists it, it is clean, and no task claims it — every
    // condition for removal but the one that matters.
    expect(report.removed).toEqual([]);
    expect(report.unclaimed).toEqual([]);
    expect(fs.readFileSync(path.join(outside, "README.md"), "utf8")).toBe("on main\n");
    expect(await git(root, "worktree", "list", "--porcelain")).toContain(outside);
    // And the root itself is still standing. Nothing here can reach it — the
    // walk only ever yields paths two levels below — but it is the directory a
    // recursive delete would be catastrophic on, so it is asserted rather than
    // assumed.
    expect(fs.existsSync(worktreesRoot())).toBe(true);
  });

  // A repository on a mount that has gone away, or one the user deleted while
  // its checkouts stayed. The sweep runs on the boot path with nothing to hand
  // a rejection to, so this has to end in a report rather than a throw — and
  // the orphan it cannot ask about has to end up as a card, not a deletion.
  test("survives a repository that is no longer there", async () => {
    const { root } = await tempRepo();
    const created = await createWorktree(project(root), task("Repo gone"), "main");
    fs.rmSync(root, { recursive: true, force: true });

    const report = await sweep([root]);

    expect(report.removed).toEqual([]);
    expect(report.unclaimed).toEqual([{
      path: created.worktreePath,
      repoRoot: null,
      branch: null,
      dirty: null,
    }]);
    expect(fs.existsSync(created.worktreePath)).toBe(true);
  });

  // One repository, one lock, one prune — and the dirty one must not take the
  // clean one down with it or vice versa. This is the shape a real boot has:
  // several tasks' worth of residue in the same repository, some of it holding
  // work and some of it not.
  test("judges each orphan in a repository on its own", async () => {
    const { root } = await tempRepo();
    const p = project(root);
    const clean = await createWorktree(p, task("Nothing in it"), "main");
    const dirty = await createWorktree(p, task("Something in it"), "main");
    const kept = await createWorktree(p, task("Someone's task"), "main");
    fs.writeFileSync(path.join(dirty.worktreePath, "notes.md"), "unsaved\n");

    const report = await sweep([root], [kept.worktreePath]);

    expect(report.removed).toEqual([clean.worktreePath]);
    expect(report.unclaimed.map((w) => w.path)).toEqual([dirty.worktreePath]);
    expect(fs.existsSync(clean.worktreePath)).toBe(false);
    expect(fs.existsSync(dirty.worktreePath)).toBe(true);
    expect(fs.existsSync(kept.worktreePath)).toBe(true);
  });

  // A detached HEAD is what an abandoned rebase in an orphaned checkout looks
  // like, and `--show-current` prints nothing and still exits 0 on one. The
  // card takes the null, because a branch name invented here would be a name
  // the user could not find.
  test("a dirty orphan on a detached HEAD gets a card with no branch", async () => {
    const { root } = await tempRepo();
    const created = await createWorktree(project(root), task("Mid rebase"), "main");
    await git(created.worktreePath, "checkout", "-q", "--detach");
    fs.writeFileSync(path.join(created.worktreePath, "conflict.txt"), "<<<<<<<\n");

    const report = await sweep([root]);

    expect(report.removed).toEqual([]);
    expect(report.unclaimed).toEqual([{
      path: created.worktreePath,
      repoRoot: root,
      branch: null,
      dirty: 1,
    }]);
    expect(fs.existsSync(created.worktreePath)).toBe(true);
  });
});
