import * as fs from "fs";
import { gitSpawn } from "../../api/utils";

// What archive has to know before it destroys anything
// (docs/v2-architecture.md §5.6).
//
// Everything here is read-only and every question fails closed: a git call that
// does not exit 0 is answered as "we could not establish that this is safe",
// never as "it is safe". The asymmetry is the point — this is what a
// confirmation dialog is populated from, and the cost of over-reporting risk is
// a branch that outlives its task, while the cost of under-reporting it is
// commits nobody can get back.

export interface BranchStatus {
  /** Whether the branch is still in the repository at all. */
  exists: boolean;
  /** Files `git status --porcelain` reports in the checkout, untracked
   * included. `null` when the checkout is not on disk (an evicted task). */
  dirty: number | null;
  /** Commits on the branch that are in neither the base ref nor any
   * remote-tracking ref. */
  unpushed: number;
  /** The branch tip is an ancestor of the base ref. */
  merged: boolean;
  /** The branch tip is contained in some `refs/remotes/*` ref. */
  pushed: boolean;
}

/** How many files `git status --porcelain` reports in the checkout.
 *
 * `null` means "we could not tell", and it is deliberately not folded into 0.
 * The number is shown in a dialog describing what is about to be destroyed, so
 * a git that failed — a half-removed worktree, a repository on a mount that has
 * gone away — must not read there as "clean, nothing to lose". An evicted task
 * reaches the same answer through the same door: no directory, no count.
 *
 * Exported for the boot sweep (TASK-32), which asks the same question for the
 * same reason and must answer it the same way: it deletes orphaned checkouts,
 * and `null` folded into 0 there would delete somebody's uncommitted work. */
export async function dirtyCount(worktreePath: string | null): Promise<number | null> {
  // The existence check is not redundant with the exit code: `git -C` on a
  // missing directory fails the same way a broken repository does, and this
  // module is the only place that can tell the ordinary case (the checkout was
  // evicted, exactly as designed) from the alarming one.
  if (worktreePath === null || !fs.existsSync(worktreePath)) return null;
  // `--no-optional-locks` because this is now asked in the background, on a
  // timer and on every finished agent turn (TASK-32), and a plain `git status`
  // takes `index.lock` to write back the index it refreshed. That is a lock the
  // WIP snapshot needs: `snapshotWip` runs `git add -A` against the same
  // checkout, and the two collided as `Unable to create '…/index.lock': File
  // exists` — an archive failing because a card wanted a number.
  //
  // The flag is exactly what git provides for a tool that polls status, and it
  // costs only the cached-stat write, never accuracy: the count is computed
  // from the same comparison either way.
  const { stdout, exitCode } = await gitSpawn(worktreePath, [
    "--no-optional-locks", "status", "--porcelain",
  ]);
  if (exitCode !== 0) return null;
  return stdout.split("\n").filter((line) => line.trim() !== "").length;
}

/** Whether `baseRef` names something this repository can actually resolve.
 *
 * Asked once and separately because two of the answers below take a different
 * shape depending on it, and a base ref that has since been deleted — the
 * project's `main` renamed, a task branched from a branch that was itself
 * archived — is an ordinary state rather than a failure. `^{commit}` so a tag
 * or a symbolic ref resolves to the thing `merge-base` and `rev-list` need. */
async function resolves(repoRoot: string, ref: string | null): Promise<boolean> {
  if (ref === null) return false;
  const { exitCode } = await gitSpawn(repoRoot, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  return exitCode === 0;
}

/** Commits the branch would take with it if it were deleted.
 *
 * `--not` is what makes this the right number rather than an approximation of
 * it: the count is the branch's commits minus everything already on a remote
 * and minus everything already in the base ref — precisely the set that has no
 * other reference keeping it alive.
 *
 * Bounding by the base ref matters more than it looks. `--remotes` expands to
 * nothing in a repository with no remote configured, which is the normal state
 * of a scratch repo, so without the base term the branch is measured against
 * the empty set and the whole history back to the root commit is reported as
 * unpushed. With no usable base we accept exactly that degradation and say so:
 * the number then means "not on a remote", which over-reports and never
 * under-reports — the safe direction for a number captioned "will be lost".
 *
 * A failed call answers 0, and the count is cosmetic in the one way that
 * matters: the decision to delete rests on `merged`/`pushed`, which both fail
 * closed to `false`, so a lost count can make the dialog understate the stakes
 * of a delete it will not be offering. */
async function unpushedCount(repoRoot: string, branch: string, baseRef: string | null): Promise<number> {
  // Fully qualified, for the reason `existingBranches` spells out in
  // `branch.ts`: a repository that also has a *tag* by this name resolves the
  // bare form to the tag, and the count would then be about a ref nobody asked
  // for. The base ref is left as the user wrote it — it is theirs to name.
  const args = ["rev-list", "--count", `refs/heads/${branch}`, "--not", "--remotes"];
  if (baseRef !== null) args.push(baseRef);
  const { stdout, exitCode } = await gitSpawn(repoRoot, args);
  if (exitCode !== 0) return 0;
  const n = parseInt(stdout.trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

/** Whether the branch tip is already contained in the base ref. */
async function isMerged(repoRoot: string, branch: string, baseRef: string | null): Promise<boolean> {
  // No base ref, no claim. `--is-ancestor` distinguishes its answers by exit
  // code (0 yes, 1 no) and uses every other code for "something went wrong",
  // so anything but a clean 0 has to mean "not established" — the two failure
  // modes are indistinguishable from here and only one of them is safe.
  if (baseRef === null) return false;
  const { exitCode } = await gitSpawn(repoRoot, [
    "merge-base", "--is-ancestor", `refs/heads/${branch}`, baseRef,
  ]);
  return exitCode === 0;
}

/** Whether some remote-tracking ref contains the branch tip.
 *
 * Not `@{u}`: a branch we made has no upstream configured unless the user
 * pushed it with `-u` themselves, so an upstream comparison would report almost
 * every pushed branch as unpushed. And upstream is the wrong question anyway —
 * what archive needs to know is whether the commits survive the branch's
 * deletion, and any `refs/remotes/*` ref containing the tip answers that
 * regardless of which remote it is or what the branch is configured to track.
 *
 * `--count=1` because the identity of the ref is not wanted, only whether there
 * is one; git stops walking once it has it. */
async function isPushed(repoRoot: string, branch: string): Promise<boolean> {
  const { stdout, exitCode } = await gitSpawn(repoRoot, [
    "for-each-ref", "--count=1", "--format=%(refname)", "--contains", `refs/heads/${branch}`,
    "refs/remotes/",
  ]);
  // Fails closed for the same reason as the rest: a `--contains` that errored
  // out has told us nothing, and "nothing" is not "not on a remote".
  if (exitCode !== 0) return false;
  return stdout.trim() !== "";
}

/** The git facts about a task's branch and checkout, read before an archive
 * destroys anything.
 *
 * Two rounds rather than one `Promise.all`, because a dialog is waiting on
 * this and every question that can be asked at the same time as another is:
 * the branch's existence, the checkout's dirt and the base ref's resolvability
 * depend on nothing, and the three answers that depend on those go together in
 * the second round. Serializing all five would put five git startups on the
 * latency of opening a confirmation.
 *
 * A branch that is gone short-circuits: there is nothing to lose and nothing to
 * delete, so the commit-counting questions have no subject and answering them
 * would only be asking git about a ref it has already said is not there. The
 * dirty count survives the short-circuit — an orphaned checkout whose branch
 * someone deleted by hand still holds files, and that is exactly the case where
 * saying "0 changes" would be a lie. */
export async function branchStatus(
  repoRoot: string,
  target: { branch: string; baseRef: string | null; worktreePath: string | null },
): Promise<BranchStatus> {
  const [head, dirty, baseUsable] = await Promise.all([
    gitSpawn(repoRoot, ["rev-parse", "--verify", "--quiet", `refs/heads/${target.branch}`]),
    dirtyCount(target.worktreePath),
    resolves(repoRoot, target.baseRef),
  ]);
  if (head.exitCode !== 0) {
    return { exists: false, dirty, unpushed: 0, merged: false, pushed: false };
  }

  // An unresolvable base is passed on as no base at all, so the two questions
  // that take one degrade in the documented way instead of asking git about a
  // ref it will reject.
  const base = baseUsable ? target.baseRef : null;
  const [unpushed, merged, pushed] = await Promise.all([
    unpushedCount(repoRoot, target.branch, base),
    isMerged(repoRoot, target.branch, base),
    isPushed(repoRoot, target.branch),
  ]);
  return { exists: true, dirty, unpushed, merged, pushed };
}

/** Whether deleting the branch would lose commits.
 *
 * The §5.6 criterion, and narrower than it sounds: merged-into-base or on a
 * remote are the two ways the commits have somewhere else to live. Dirt is not
 * in it — uncommitted work is not something branch deletion can take, and the
 * dialog reports it separately for its own reasons.
 *
 * A branch that is not there is expendable by definition. The caller asks this
 * to decide whether to offer a delete, and the state it would be deleting into
 * is the state already reached. */
export function branchIsExpendable(status: BranchStatus): boolean {
  return !status.exists || status.merged || status.pushed;
}
