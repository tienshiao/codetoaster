import * as fsp from "fs/promises";
import * as path from "path";
import { gitSpawn } from "../../api/utils";
import { WorktreeError } from "./errors";
import { withRepoLock } from "./lock";
import { worktreePathFor } from "./paths";
import { assertPathFree, lockKeyFor, repoRootOf } from "./repo";
import { applyWip, readWip, wipRefFor } from "./wip";

// Rebuilding a checkout that was evicted or went missing
// (docs/v2-architecture.md §5.6). The mirror of `create.ts`: same path, same
// branch, and the working state read back out of the WIP ref.

/** What happened to the task's snapshot, which is the only part of a restore
 * that has more than one outcome.
 *
 * `applied` — the tree came back dirty, exactly as it was left.
 * `none`    — there was no snapshot, so the checkout is clean at the branch.
 * `stale`   — there was one and it was not safe to use. See below. */
export type WipDisposition = "applied" | "none" | "stale";

export interface RestoredWorktree {
  worktreePath: string;
  branch: string;
  wip: WipDisposition;
  /** The ref still holding the work, when it was not applied. The caller shows
   * apply / keep / discard against it; nothing has been thrown away. */
  staleRef?: string;
}

/** Whether the branch still exists, asked before `worktree add` rather than
 * read out of its failure. An add can fail for a dozen reasons and this is the
 * one that is not really an error: the task's work is safe in the WIP ref, and
 * what is missing is a decision about where to put it. */
async function assertBranch(repoRoot: string, branch: string): Promise<void> {
  const { exitCode, stderr } = await gitSpawn(
    repoRoot,
    ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`],
    { captureStderr: true },
  );
  if (exitCode !== 0) {
    throw new WorktreeError("branch-missing", `branch ${branch} no longer exists`, stderr);
  }
}

/** Take back a checkout this restore made, for a restore that failed after it.
 *
 * The branch is deliberately not deleted — the create-side `discard` does that
 * and here it would be the one destructive act in a function whose whole job is
 * to lose nothing. What is removed is the directory and its registration, so
 * the task's path is free for the next attempt.
 *
 * Best effort: the caller is owed the reason the restore failed, not a cleanup
 * error on top of it. */
async function discardCheckout(repoRoot: string, worktreePath: string): Promise<void> {
  const removed = await gitSpawn(repoRoot, ["worktree", "remove", "--force", worktreePath]);
  if (removed.exitCode !== 0) {
    await fsp.rm(worktreePath, { recursive: true, force: true }).catch(() => {});
    await gitSpawn(repoRoot, ["worktree", "prune"]);
  }
}

/** Put a task's checkout back, with whatever it was working on.
 *
 * The guard is the whole of the interesting part. Between the eviction and
 * now, the user may have committed to this branch from another checkout — they
 * still have the repository, and the branch was never ours alone. The snapshot
 * was taken against the old tip, so `read-tree --reset` would write the old
 * versions of every tracked file over the new commit's, and the loss would be
 * silent: the tree would look plausibly dirty, and the newer changes would be
 * gone from the working copy with nothing to say they had ever been there.
 *
 * So the parent of the snapshot is compared with HEAD, and on a mismatch the
 * restore stops at a clean checkout of the branch and hands the ref back
 * unapplied. Broken-but-actionable: the user is offered the snapshot rather
 * than surprised by it.
 *
 * The comparison is against the *new checkout's* HEAD, read after the add, and
 * not the branch tip read before it. They are the same value nearly always,
 * and when they are not, the one that matters is the one `read-tree` would
 * actually be overwriting.
 *
 * Under the repository's lock like every other worktree mutation: `worktree
 * add` writes `.git/worktrees` and takes the same locks a concurrent create
 * would. */
export function restoreWorktree(
  projectPath: string,
  projectId: string,
  task: { id: string; branch: string },
): Promise<RestoredWorktree> {
  return repoRootOf(projectPath).then(async (repoRoot) =>
    withRepoLock(await lockKeyFor(repoRoot), async () => {
      const worktreePath = worktreePathFor(projectId, task.id);
      await assertBranch(repoRoot, task.branch);
      assertPathFree(worktreePath);
      await fsp.mkdir(path.dirname(worktreePath), { recursive: true });

      // No `-b`: the branch is the task's own and outlived the checkout, which
      // is the entire premise of eviction.
      //
      // A prune rather than `--force`. The case that has to be cleared is the
      // path git still has registered from a worktree whose directory is gone
      // — what an eviction leaves if the prune did not run, and what a user
      // with `rm -rf` leaves always (`worktree_state = missing`) — and that is
      // exactly what `worktree prune` is for. `--force` would clear it too, but
      // it also overrides the safeguard against checking out a branch that is
      // already checked out somewhere else, and here the branch exists and the
      // user's own repository can be sitting on it. Forcing past that gives one
      // branch two working trees: the agent's next commit moves HEAD under the
      // user's checkout, and their tree reads as a mass of changes nobody made.
      // `create.ts` can pass `--force` safely because `-b` means its branch is
      // new and cannot be checked out anywhere.
      await gitSpawn(repoRoot, ["worktree", "prune"]);
      const add = await gitSpawn(
        repoRoot,
        ["worktree", "add", worktreePath, task.branch],
        { captureStderr: true },
      );
      if (add.exitCode !== 0) {
        throw new WorktreeError(
          "worktree-add-failed",
          `could not restore a worktree for ${task.id}`,
          add.stderr,
        );
      }

      try {
        const wip = await readWip(repoRoot, task.id);
        if (!wip) return { worktreePath, branch: task.branch, wip: "none" as const };

        const { stdout } = await gitSpawn(worktreePath, ["rev-parse", "HEAD"]);
        if (stdout.trim() !== wip.parent) {
          return {
            worktreePath,
            branch: task.branch,
            wip: "stale" as const,
            staleRef: wipRefFor(task.id),
          };
        }

        await applyWip(worktreePath, wipRefFor(task.id));
        return { worktreePath, branch: task.branch, wip: "applied" as const };
      } catch (e) {
        // Back out to nothing, the way a failed create does. The path is fixed
        // by the task's id and cannot be moved away from, so a half-restored
        // checkout left behind is not a mess to tidy later: it is a task that
        // can never be restored again, because every retry stops at
        // `assertPathFree`. Nothing durable goes with it — the branch is
        // untouched and the WIP ref still holds the work, which is what makes
        // a retry a retry rather than a second chance at losing it.
        await discardCheckout(repoRoot, worktreePath);
        throw e;
      }
    }),
  );
}
