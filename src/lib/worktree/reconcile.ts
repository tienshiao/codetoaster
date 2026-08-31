import * as fs from "fs";
import * as path from "path";
import { gitSpawn } from "../../api/utils";
import { discardCheckout } from "./evict";
import { withRepoLock } from "./lock";
import { isWithinWorktreesRoot, worktreesRoot } from "./paths";
import { lockKeyFor } from "./repo";
import { dirtyCount } from "./status";

// Reconciling what is on disk with what the database believes, once, at boot
// (docs/v2-architecture.md §5.6, Risk 5 in §9).
//
// Only one direction lives here — checkouts with no task — because it is the
// one that needs git and the filesystem. The other direction is a row update
// with no git in it at all and belongs where the rows are, in `TaskManager`.
//
// The rule the whole module is written to: **a checkout is deleted only when we
// have established that it holds nothing.** Not when it looks empty, not when
// git declined to answer. `dirtyCount` returns `null` for "could not tell", and
// every `null` here ends as an unclaimed card rather than a deletion. The cost
// of being wrong in that direction is a directory the user has to delete by
// hand; the cost of being wrong in the other is uncommitted work that no
// snapshot was ever taken of.

/** A checkout under our root that no task accounts for, and that we would not
 * remove on our own.
 *
 * `repoRoot` is null when we could not work out which repository it belongs to
 * — a directory git no longer recognises, or one that was never a worktree.
 * `dirty` is null on the same principle as `status.ts`: not established, which
 * is why it is here rather than in `removed`. */
export interface UnclaimedWorktree {
  path: string;
  repoRoot: string | null;
  branch: string | null;
  dirty: number | null;
}

export interface ReconcileReport {
  /** Checkouts removed, for the boot log (AC #1). */
  removed: string[];
  /** Checkouts left exactly as they were, for the user to decide about. */
  unclaimed: UnclaimedWorktree[];
}

/** One record of `git worktree list --porcelain`. */
interface RegisteredWorktree {
  path: string;
  branch: string | null;
}

/** The worktrees a repository has registered.
 *
 * Line-based rather than `-z`, and that is safe here because of what happens
 * when it is wrong. git quotes a path containing unusual characters, so a
 * quoted one simply fails to match `worktreesRoot()` and drops out — and the
 * directory walk below then finds the same checkout anyway and resolves its
 * repository the other way. A parse that misses degrades into the slower path,
 * never into a deletion.
 *
 * A repository we cannot list at all answers empty: it may be on a mount that
 * has gone away, and a boot sweep is not the place to make that fatal. */
async function registeredWorktrees(repoRoot: string): Promise<RegisteredWorktree[]> {
  const { stdout, exitCode } = await gitSpawn(repoRoot, ["worktree", "list", "--porcelain"]);
  if (exitCode !== 0) return [];

  const found: RegisteredWorktree[] = [];
  let current: RegisteredWorktree | null = null;
  for (const line of stdout.split("\n")) {
    // Records are separated by a blank line, and `worktree` always opens one.
    if (line.startsWith("worktree ")) {
      if (current) found.push(current);
      current = { path: line.slice("worktree ".length), branch: null };
    } else if (line.startsWith("branch ") && current) {
      current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    }
  }
  if (current) found.push(current);
  return found;
}

/** The repository a directory belongs to, asked of the directory itself.
 *
 * Not of the project: an orphaned checkout is by definition one no row claims,
 * and the project that made it may be gone (TASK-64). The common dir is the
 * one path every worktree of a repository agrees on, so `dirname` of it is the
 * main checkout — which is where `worktree remove` and `worktree prune` have to
 * run, since a linked worktree cannot remove itself.
 *
 * Null rather than a throw for anything unexpected. This is asked about a
 * directory we already suspect of being junk, and "we cannot tell" is an answer
 * the caller has a safe branch for. */
async function repoOfCheckout(dir: string): Promise<string | null> {
  const { stdout, exitCode } = await gitSpawn(dir, ["rev-parse", "--git-common-dir"]);
  const common = stdout.trim();
  if (exitCode !== 0 || !common) return null;
  // git answers relatively from a main worktree and absolutely from a linked
  // one, so this has to be resolved against the directory asked about.
  const root = path.dirname(path.resolve(dir, common));
  // A bare repository's common dir is the repository itself, and `dirname` of
  // that is its parent — which is not a repository at all. Confirming with a
  // toplevel keeps a wrong answer from becoming a `worktree remove` run
  // somewhere it was never meant to run.
  const { stdout: top, exitCode: topCode } = await gitSpawn(root, ["rev-parse", "--show-toplevel"]);
  return topCode === 0 && top.trim() ? top.trim() : null;
}

/** Every checkout directory we have made, as it stands on disk.
 *
 * Two levels exactly — `<root>/<projectId>/<taskId>` — because that is the
 * shape `worktreePathFor` writes and anything else under the root is not ours
 * to reason about. Deliberately not recursive: a walk that went deeper would
 * start reporting the *contents* of a checkout as checkouts. */
function checkoutsOnDisk(): string[] {
  const root = worktreesRoot();
  const found: string[] = [];
  let projects: fs.Dirent[];
  try {
    projects = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    // No root at all is the normal state of an install that has never made a
    // worktree, not a failure.
    return found;
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    let tasks: fs.Dirent[];
    try {
      tasks = fs.readdirSync(path.join(root, project.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const task of tasks) {
      if (task.isDirectory()) found.push(path.join(root, project.name, task.name));
    }
  }
  return found;
}

/** Reconcile the checkouts on disk against the tasks that claim them.
 *
 * `claimed` is every path a non-archived row names, already resolved. Archived
 * rows are deliberately not in it: archive removes the checkout and keeps only
 * the branch and the snapshot (TASK-31), so a directory still standing for one
 * is the residue of a removal that failed, and removing it now is finishing the
 * job rather than second-guessing it.
 *
 * `repoRoots` is where to look first — the repositories the daemon already
 * knows about, from projects and from tasks' `worktree_repo`. It is an
 * optimisation and not the source of truth: git's own list gives us a
 * checkout's repository for free where it works, and the directory walk catches
 * everything it misses, including a checkout whose registration was pruned
 * while the directory was left behind.
 *
 * Never throws. It runs on the boot path with nothing to hand a rejection to,
 * and one repository on a dead mount is no reason to leave every other one
 * unreconciled. */
export async function reconcileWorktrees(input: {
  repoRoots: readonly string[];
  claimed: ReadonlySet<string>;
}): Promise<ReconcileReport> {
  const root = worktreesRoot();
  // Path → the repository it belongs to, where something already knows. Filled
  // from git's list first because that answer is free; the walk below only has
  // to work for what is left.
  const knownRepo = new Map<string, string>();
  for (const repoRoot of new Set(input.repoRoots)) {
    for (const registered of await registeredWorktrees(repoRoot)) {
      const resolved = path.resolve(registered.path);
      if (isWithinWorktreesRoot(resolved)) knownRepo.set(resolved, repoRoot);
    }
  }

  // The union of the two views, minus everything a task claims. A registered
  // worktree whose directory is gone is *not* an orphan to act on — that is
  // what `worktree prune` is for, at the end.
  const orphans = checkoutsOnDisk()
    .map((dir) => path.resolve(dir))
    .filter((dir) => !input.claimed.has(dir));

  const report: ReconcileReport = { removed: [], unclaimed: [] };
  // Grouped so a repository's removals and its prune happen under one lock
  // rather than one lock each: every one of them mutates `.git/worktrees`, and
  // that is the list branch allocation reads.
  const byRepo = new Map<string, string[]>();

  for (const dir of orphans) {
    const repoRoot = knownRepo.get(dir) ?? (await repoOfCheckout(dir));
    const dirty = await dirtyCount(dir);
    if (repoRoot === null || dirty === null || dirty > 0) {
      // Everything we could not establish, and everything holding files. AC #2:
      // a dirty orphan is never removed automatically, however orphaned.
      report.unclaimed.push({
        path: dir,
        repoRoot,
        branch: repoRoot === null ? null : await branchOf(dir),
        dirty,
      });
      continue;
    }
    byRepo.set(repoRoot, [...(byRepo.get(repoRoot) ?? []), dir]);
  }

  for (const [repoRoot, dirs] of byRepo) {
    try {
      await withRepoLock(await lockKeyFor(repoRoot), async () => {
        for (const dir of dirs) {
          // AC #4, asked again here rather than trusted from the enumeration.
          // This is a recursive delete, and the guard belongs immediately above
          // the call that does it — the way `removeTaskDir` re-checks the tasks
          // root — so no future caller can reach the removal by another route.
          if (!isWithinWorktreesRoot(dir) || path.resolve(dir) === path.resolve(root)) continue;
          await discardCheckout(repoRoot, dir);
          // Checked, not assumed. `discardCheckout` swallows its own failures
          // — git's remove and then an `rm` — so an unconditional push here
          // would have the boot log claim a deletion that did not happen, on a
          // directory whose whole purpose in that log is accountability for
          // having deleted it.
          if (!fs.existsSync(dir)) report.removed.push(dir);
        }
        // After the removals, so it also collects the registrations of
        // checkouts somebody deleted by hand between two daemon runs.
        await gitSpawn(repoRoot, ["worktree", "prune"]);
      });
    } catch (e) {
      console.warn(`Could not reconcile worktrees in ${repoRoot}:`, e);
    }
  }

  // Repositories with nothing to remove still need pruning: a checkout deleted
  // by hand leaves a registration behind, and that is the commonest way one
  // gets there.
  for (const repoRoot of new Set(input.repoRoots)) {
    if (byRepo.has(repoRoot)) continue;
    try {
      await withRepoLock(await lockKeyFor(repoRoot), () =>
        gitSpawn(repoRoot, ["worktree", "prune"]).then(() => undefined),
      );
    } catch (e) {
      console.warn(`Could not prune worktrees in ${repoRoot}:`, e);
    }
  }

  return report;
}

/** The branch an orphaned checkout has checked out, for its card.
 *
 * `--show-current` prints nothing and still exits 0 on a detached HEAD, which
 * is what an interrupted rebase in an abandoned checkout looks like — so the
 * empty answer here means "no branch", not "the call failed". Either way the
 * card gets `null` and says so. */
async function branchOf(dir: string): Promise<string | null> {
  const { stdout, exitCode } = await gitSpawn(dir, ["branch", "--show-current"]);
  const name = stdout.trim();
  return exitCode === 0 && name ? name : null;
}
