import * as fs from "fs";
import * as path from "path";
import { gitSpawn } from "../../api/utils";
import { WorktreeError } from "./errors";

// Locating the repository a worktree operation acts on, and the key its
// operations serialize under (docs/v2-architecture.md §5.6). Shared by create
// and restore: both add a worktree, so both need the same two answers.

/** The repository the project's directory belongs to.
 *
 * Asked for rather than taken from the task's `repo_root`, because a worktree
 * is added to the *project's* repository and the task's cwd is not that yet —
 * at create time the task has no checkout of its own, and by restore time the
 * checkout it had is gone. */
export async function repoRootOf(dir: string): Promise<string> {
  const { stdout, exitCode, stderr } = await gitSpawn(dir, ["rev-parse", "--show-toplevel"], {
    captureStderr: true,
  });
  const root = stdout.trim();
  if (exitCode !== 0 || !root) {
    throw new WorktreeError("not-a-repo", `${dir} is not inside a git repository`, stderr);
  }
  return root;
}

/** What to serialize this repository's worktree operations on.
 *
 * Not the toplevel. `--show-toplevel` answers with the *worktree's* root, so a
 * project whose directory is itself a linked worktree — one of ours, or one
 * the user made — gets a different answer from a project pointing at the main
 * checkout of the same repository. They would take two different locks, and
 * branch allocation is repository-wide: `.git/worktrees` and the ref store are
 * shared, so those two creates are exactly the pair the lock exists to keep
 * apart. The common dir is the one path every worktree of a repository agrees
 * on. Resolved against `repoRoot` because git answers `.git` relatively from
 * the main worktree and absolutely from a linked one. */
export async function lockKeyFor(repoRoot: string): Promise<string> {
  const { stdout, exitCode } = await gitSpawn(repoRoot, ["rev-parse", "--git-common-dir"]);
  const common = stdout.trim();
  // Falling back to the toplevel rather than failing: a git too old to know
  // the option still serializes correctly for every project that points at a
  // main checkout, which is all of them until someone nests one.
  return exitCode === 0 && common ? path.resolve(repoRoot, common) : repoRoot;
}

/** Refuse a path that already has something in it.
 *
 * An *empty* directory is allowed through, because `git worktree add` accepts
 * one and because that is what a create interrupted before git ran leaves
 * behind — failing on it would make one dead create poison the task's path
 * forever, and the path is fixed by the task's id and cannot be moved away
 * from (`paths.ts`). */
export function assertPathFree(worktreePath: string): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(worktreePath);
  } catch {
    // Not there at all, which is the normal case, or unreadable — in which
    // case git is about to give a much better message than a stat would.
    return;
  }
  if (entries.length > 0) {
    throw new WorktreeError("path-occupied", `${worktreePath} already exists and is not empty`);
  }
}
