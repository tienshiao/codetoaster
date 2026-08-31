import { gitSpawn } from "../../api/utils";

/** Every branch we create lives under this one prefix, so a user can tell ours
 * from theirs at a glance, delete the lot with one refspec, and never have a
 * task collide with a branch they made by hand. */
export const BRANCH_PREFIX = "codetoaster";

/** Git will not take a ref path component of unbounded length — the reference
 * is a file under `.git/refs/heads/` on the ordinary backend, and a filesystem
 * component stops at 255 bytes. Well short of it, because the point of putting
 * the title here is that a human reads it in `git branch`, and the first sixty
 * characters of a title are the ones that identify it. */
const MAX_SLUG_LENGTH = 60;

/** The branch name a title asks for, before collisions are considered.
 *
 * The *title*, not the task's URL slug. They look alike and are not: the URL
 * slug ends in the task's uuid, which is what makes a link survive a rename —
 * and which would also make every branch name unique by construction, so the
 * collision suffixing §5.6 asks for would be dead code guarding a case that
 * cannot happen. A branch outlives its task (archive keeps it; §5.6), so it is
 * addressed to whoever reads `git branch` a month later, and thirty-six
 * characters of uuid tell them nothing.
 *
 * A title that slugifies to nothing — punctuation, a non-Latin script, an
 * empty string — falls back to the task id. It is unreadable, but it is a
 * valid ref and it is unique, and the alternative is refusing to make a
 * worktree because of what someone called their task. */
export function branchSlug(task: { id: string; title: string }): string {
  const slug = task.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, MAX_SLUG_LENGTH)
    // After the truncation, not before: cutting mid-word leaves the trailing
    // dash that the first strip would have removed, and `refs/heads/x-` is a
    // name git accepts and nobody wants.
    .replace(/^-+|-+$/g, "");
  return slug || task.id;
}

/** The branches already under our prefix in this repository.
 *
 * One `for-each-ref` rather than a `show-ref` per candidate: the answer is
 * needed as a set anyway, since choosing a suffix means asking about names
 * until one is free, and a repository with a hundred tasks would otherwise
 * spawn a hundred gits to find that out. */
async function existingBranches(repoRoot: string): Promise<Set<string>> {
  // `%(refname)`, and the prefix taken off here — not `%(refname:short)`.
  // "Short" means "as short as is unambiguous", so a repository that also has
  // a *tag* called `codetoaster/fix-the-parser` gets `heads/codetoaster/...`
  // back for the branch of that name. The set would then not contain the name
  // it was asked about, `allocateBranch` would hand back a branch that exists,
  // and `worktree add -b` would fail on it.
  const { stdout, exitCode } = await gitSpawn(repoRoot, [
    "for-each-ref", "--format=%(refname)", `refs/heads/${BRANCH_PREFIX}/`,
  ]);
  // A repository with no branches under the prefix answers empty and exits 0;
  // anything else means we could not find out, and treating "cannot tell" as
  // "nothing is there" would hand back a name that already exists. Answering
  // with an empty set is still right in that case — `git worktree add -b` is
  // the real check, and it fails loudly on a branch that exists — but the
  // suffix search must not silently settle on the unsuffixed name forever.
  if (exitCode !== 0) return new Set();
  const HEADS = "refs/heads/";
  return new Set(
    stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith(HEADS))
      .map((line) => line.slice(HEADS.length)),
  );
}

/** A branch name for this task that no branch in the repository already has.
 *
 * Must be called under `withRepoLock` for the repository: this reads the set
 * of branches and the caller creates one from the answer, and two creates that
 * interleave those two steps choose the same name.
 *
 * Suffixes count from 2, so the first task to want a name gets the bare one —
 * `codetoaster/fix-the-parser`, then `codetoaster/fix-the-parser-2`. Starting
 * at 1 would read as though there were a zeroth. */
export async function allocateBranch(
  repoRoot: string,
  task: { id: string; title: string },
): Promise<string> {
  const taken = await existingBranches(repoRoot);
  const base = `${BRANCH_PREFIX}/${branchSlug(task)}`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Delete a local branch, having already decided that is safe.
 *
 * `-D` and not `-d`, because git's own safety check answers a different
 * question than ours. `-d` refuses unless the branch is merged into HEAD or
 * into its upstream; §5.6's criterion is merged into the task's *base ref* or
 * contained in any `refs/remotes/*` ref, which `branchStatus` establishes
 * before this is called. The two sets overlap without containing each other:
 * `-d` would refuse a branch pushed to a remote it has no upstream
 * configuration for — the ordinary case here — while accepting one merged into
 * whatever HEAD happens to be, which is not a promise anybody asked for. Making
 * the decision twice by two different rules gets a delete that is refused for
 * reasons the dialog cannot explain.
 *
 * Local only. The remote is never touched (§5.6), so a branch on a remote stays
 * there and is precisely why deleting the local one was safe.
 *
 * Answers the state, not the command: a branch that was already absent is the
 * state this asks for, so it is `true`. The re-check is what makes that true
 * without parsing git's refusal message. */
export async function deleteBranch(repoRoot: string, branch: string): Promise<boolean> {
  const { exitCode } = await gitSpawn(repoRoot, ["branch", "-D", branch]);
  if (exitCode === 0) return true;
  const still = await gitSpawn(repoRoot, [
    "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`,
  ]);
  return still.exitCode !== 0;
}
