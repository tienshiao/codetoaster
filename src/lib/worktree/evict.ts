import * as fsp from "fs/promises";
import { gitSpawn } from "../../api/utils";
import { withRepoLock } from "./lock";
import { lockKeyFor } from "./repo";

// Taking a checkout off disk while keeping everything that matters about it
// (docs/v2-architecture.md §5.6).

/** Remove a worktree's directory and git's registration of it, and nothing
 * else.
 *
 * The branch stays, and that is the entire difference between this and
 * `removeWorktree`. They run almost the same git and mean opposite things:
 * `removeWorktree` undoes a create that failed, so the branch it made has to go
 * with it or the next attempt at the same task inherits an unearned `-2`.
 * Eviction is the opposite premise — the branch and the WIP ref are what the
 * task *is*, and the directory is the disposable part. Reusing the create's
 * cleanup here would delete the work it is supposed to be preserving.
 *
 * `--force` because the tree holds files git does not know about — the
 * `worktree_copy` entries, whatever setup wrote, the dirt the WIP snapshot has
 * already captured — which is exactly what `worktree remove` refuses to discard
 * on its own.
 *
 * Falls back to removing the directory outright when git refuses. The
 * registration it leaves behind is not a problem for the restore: that path
 * prunes before it adds, precisely because this is the state an eviction can
 * end in. */
export async function discardCheckout(repoRoot: string, worktreePath: string): Promise<void> {
  const removed = await gitSpawn(repoRoot, ["worktree", "remove", "--force", worktreePath]);
  if (removed.exitCode !== 0) {
    await fsp.rm(worktreePath, { recursive: true, force: true }).catch(() => {});
    await gitSpawn(repoRoot, ["worktree", "prune"]);
  }
}

/** Evict a task's checkout, from outside the worktree module.
 *
 * Takes the repository root rather than the project's directory, because a task
 * has to be evictable after its project is gone (TASK-64): the row carries the
 * repository it was branched from, and resolving one from a project that may
 * have been deleted is the bug this replaced.
 *
 * Under the repository's lock, because removing a worktree mutates the list
 * that branch allocation reads — an eviction racing a create in the same
 * repository is two writers to `.git/worktrees`.
 *
 * Says nothing about whether evicting was a good idea. The snapshot has to have
 * been taken first, and the caller is what knows that. */
export async function evictWorktree(repoRoot: string, worktreePath: string): Promise<void> {
  await withRepoLock(await lockKeyFor(repoRoot), () => discardCheckout(repoRoot, worktreePath));
}
