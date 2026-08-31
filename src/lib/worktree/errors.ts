/** What went wrong, as something a caller can branch on.
 *
 * `bad-base-ref`     — the ref the task asked to branch from does not resolve
 *                      to a commit. A user typo, or a branch deleted since the
 *                      project's default was set.
 * `path-occupied`    — something is already at the task's worktree path. The
 *                      path is derived from ids (`paths.ts`), so this is never
 *                      a name clash between two tasks; it is a leftover from a
 *                      create that died, or a directory the user made.
 * `worktree-add-failed` — git refused, and `stderr` says why.
 * `copy-failed`      — a `worktree_copy` entry could not be copied. The
 *                      checkout is removed again before this is thrown, so a
 *                      create either produces a set-up worktree or none.
 * `not-a-repo`       — the project's directory is not inside a git repository,
 *                      so there is nothing to add a worktree to.
 * `branch-missing`   — the branch a restore was going to check out is gone.
 *                      Told apart from `worktree-add-failed` deliberately: the
 *                      work is not lost — the WIP ref still holds it — but no
 *                      checkout can be made until someone decides what branch
 *                      it belongs on, and that is a card with buttons rather
 *                      than an error string (§5.6).
 * `snapshot-failed`  — a step of the WIP snapshot failed, so the checkout is
 *                      not safe to evict. The live tree is untouched either
 *                      way: the snapshot works through a throwaway index.
 * `wip-apply-failed` — the snapshot could not be read back into a restored
 *                      checkout. The ref is kept, so the work still exists.
 * `repo-unknown`     — the task has no record of which repository it was
 *                      branched from, and the project that knew is gone. Told
 *                      apart from `not-a-repo` because they ask for different
 *                      things: that one means "this directory is not a
 *                      repository", which pointing at one fixes, while this
 *                      means "we have lost track of yours" — and the work is
 *                      still on its branch either way (TASK-64). */
export type WorktreeErrorKind =
  | "bad-base-ref"
  | "path-occupied"
  | "worktree-add-failed"
  | "copy-failed"
  | "not-a-repo"
  | "branch-missing"
  | "snapshot-failed"
  | "wip-apply-failed"
  | "repo-unknown";

/** A worktree operation that failed, carrying git's own account of it.
 *
 * `stderr` is the whole reason this is a class rather than a rejected string.
 * git explains itself in stderr and nowhere else — `fatal: invalid reference`,
 * `fatal: '<path>' already exists` — and a "could not create worktree" that
 * drops it leaves the user with a failure and no fact about it. Empty when the
 * failure was ours rather than git's. */
export class WorktreeError extends Error {
  constructor(
    readonly kind: WorktreeErrorKind,
    message: string,
    readonly stderr: string = "",
  ) {
    super(stderr ? `${message}: ${stderr.trim()}` : message);
    this.name = "WorktreeError";
  }
}
