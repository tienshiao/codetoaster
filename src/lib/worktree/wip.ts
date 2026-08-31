import * as fsp from "fs/promises";
import * as path from "path";
import { gitSpawn } from "../../api/utils";
import { taskDir } from "../agent/spawn";
import { WorktreeError } from "./errors";

// The WIP snapshot that makes a dirty worktree evictable
// (docs/v2-architecture.md §5.6).
//
// The premise of the whole worktree design is that the checkout is a
// materialized cache and the branch is the durable artifact. That is only true
// while the tree is clean, and in-progress cattle are dirty nearly all the
// time — so a "never evict dirty" rule would exempt exactly the tasks that
// cause the sprawl. This module closes the gap: the working state becomes a
// commit under our own ref namespace, which is durable in the same way the
// branch is, and the directory goes back to being disposable.
//
// Nothing here touches the database. The caller stores `wip_ref`/`wip_at`; the
// functions below deal only in git.

/** Where a task's snapshot lives.
 *
 * Under `refs/codetoaster/` rather than `refs/stash`: a ref is what keeps the
 * objects alive against `gc`, and either namespace would do that, but the
 * stash is a stack the user pushes and pops by hand. Putting ours on it would
 * mean a `git stash pop` could consume a snapshot the daemon was relying on,
 * and a `git stash list` would show entries nobody made. Our own namespace is
 * invisible to every command the user runs and is one refspec to delete.
 *
 * Keyed by task id for the same reason the worktree path is (`paths.ts`): it
 * has to be the same answer forever, and a title can be edited. */
export function wipRefFor(taskId: string): string {
  return `refs/codetoaster/wip/${taskId}`;
}

/** The identity a snapshot commit is made with.
 *
 * Set explicitly, for two reasons. `git commit-tree` refuses to build a commit
 * when it cannot work out who is committing — `user.useConfigOnly = true` is a
 * real setting and it fails outright there — and a snapshot that only works on
 * machines with a configured identity is a snapshot that silently stops
 * protecting some users' work. And the attribution would be wrong even where
 * it succeeds: this commit is a daemon's bookkeeping, not something the user
 * authored, and it should not carry their name into a `git log` that happens
 * to reach it.
 *
 * `.invalid` is the reserved TLD that can never resolve (RFC 2606), so the
 * address is unmistakably not a mailbox. */
const WIP_IDENTITY = {
  GIT_AUTHOR_NAME: "codetoaster",
  GIT_AUTHOR_EMAIL: "wip@codetoaster.invalid",
  GIT_COMMITTER_NAME: "codetoaster",
  GIT_COMMITTER_EMAIL: "wip@codetoaster.invalid",
} as const;

/** Where the throwaway index goes.
 *
 * Beside the task's settings and setup stamp rather than inside the checkout:
 * the point of the exercise is that the live worktree is not touched, and a
 * file written into it — even one removed afterwards — would show up in a
 * `git status` the user could be running at that moment. */
function tempIndexPath(taskId: string): string {
  return path.join(taskDir(taskId), "wip.index");
}

export interface WipSnapshot {
  /** The ref that now points at the snapshot. */
  ref: string;
  /** The commit it points at, so a caller can record or compare it. */
  commit: string;
  /** When it was taken, for the grace period the evict tier computes. */
  at: number;
}

/** A git call in the worktree that must succeed, with git's own account of why
 * it did not. Every step of the snapshot is one of these: they run in sequence
 * and each depends on the last, so there is no useful partial result. */
async function must(
  cwd: string,
  args: string[],
  what: string,
  env?: Record<string, string>,
): Promise<string> {
  const { stdout, stderr, exitCode } = await gitSpawn(cwd, args, { captureStderr: true, env });
  if (exitCode !== 0) {
    throw new WorktreeError("snapshot-failed", what, stderr);
  }
  return stdout.trim();
}

/** Commit the entire working state of a task's checkout to `refs/codetoaster/wip/<id>`.
 *
 * The trick is `GIT_INDEX_FILE`. Staging everything is the only way to get a
 * tree object out of git, and staging everything in the *live* index would
 * mean the user's own staged/unstaged split was destroyed by an eviction they
 * never asked for. Pointed at a scratch file instead, `read-tree`/`add`/
 * `write-tree` build the tree they would have built and the real index is
 * never opened. `commit-tree` then hangs that tree off HEAD without moving any
 * branch: no synthetic commit appears in the user's history, and nothing
 * untracked is promoted to tracked.
 *
 * Written unconditionally, clean tree or not. A conditional ref would make
 * `wip_ref` mean two things — "nothing was dirty" and "we never got to it" —
 * and the caller would have to tell them apart to know whether an eviction
 * was safe. Always writing costs one commit object per eviction and leaves
 * restore with a single question to ask.
 *
 * Two known simplifications, both from §5.6 and both deliberate: one tree
 * cannot express the staged/unstaged split, so staged files come back as
 * ordinary modifications; and `git add -A` honours `.gitignore`, so ignored
 * build output does not survive. `setup_command` and `worktree_copy` are what
 * put the second back, which is why they are load-bearing rather than a
 * convenience. */
export async function snapshotWip(task: {
  id: string;
  worktreePath: string;
}): Promise<WipSnapshot> {
  const indexFile = tempIndexPath(task.id);
  await fsp.mkdir(path.dirname(indexFile), { recursive: true });
  // A leftover from a snapshot that died would be read as a starting index by
  // `read-tree`, which then merges into it rather than replacing it.
  await fsp.rm(indexFile, { force: true });
  // Absolute, because git resolves a relative `GIT_INDEX_FILE` against the
  // process's cwd — which here is the worktree, so a relative path would put
  // the scratch index inside the tree being snapshotted.
  const env = { GIT_INDEX_FILE: path.resolve(indexFile) };

  try {
    await must(task.worktreePath, ["read-tree", "HEAD"], "could not seed a snapshot index", env);
    await must(task.worktreePath, ["add", "-A"], "could not stage the working tree", env);
    const tree = await must(task.worktreePath, ["write-tree"], "could not write a snapshot tree", env);
    const commit = await must(
      task.worktreePath,
      ["commit-tree", tree, "-p", "HEAD", "-m", `codetoaster wip ${task.id}`],
      "could not commit the snapshot",
      { ...WIP_IDENTITY },
    );
    const ref = wipRefFor(task.id);
    // `update-ref` and not `branch -f`: this is not a branch, and the ref lives
    // outside `refs/heads` precisely so nothing that enumerates branches — the
    // user's `git branch`, our own collision search — ever sees it.
    await must(task.worktreePath, ["update-ref", ref, commit], "could not point the WIP ref");
    return { ref, commit, at: Date.now() };
  } finally {
    // The index is scratch and holds a full copy of the tree's entries; a
    // failed snapshot has no more use for it than a successful one.
    await fsp.rm(indexFile, { force: true }).catch(() => {});
  }
}

export interface WipCommit {
  commit: string;
  /** The worktree's HEAD at the moment of the snapshot. The whole point of
   * recording it: `applyWip` overwrites tracked files with this commit's
   * versions, which is only safe on a tree that is still at this commit. */
  parent: string;
}

/** What a task's WIP ref points at, or `null` if it has none.
 *
 * Absence is an ordinary answer — a task evicted while clean still has a ref
 * (see `snapshotWip`), but a task that has never been evicted, or one whose
 * ref was expired or discarded, has nothing — so it is not an error. */
export async function readWip(repoRoot: string, taskId: string): Promise<WipCommit | null> {
  const ref = wipRefFor(taskId);
  // One `rev-list` rather than two `rev-parse --verify`s: `--verify` takes
  // exactly one argument and exits 1 when handed two, so asking for the commit
  // and its parent in one call has to be this form. `--parents` prints the
  // commit followed by its parents on one line, which also makes the
  // parentless case — a snapshot taken on a repository's root commit — an
  // answer with one field rather than a failure to interpret.
  const { stdout, exitCode } = await gitSpawn(repoRoot, ["rev-list", "-n", "1", "--parents", ref]);
  if (exitCode !== 0) return null;
  const [commit, parent] = stdout.trim().split(/\s+/);
  // A snapshot with no parent cannot be checked against the branch, and the
  // check is the only thing standing between a stale ref and someone's newer
  // commit — so it is treated as no snapshot at all rather than applied blind.
  if (!commit || !parent) return null;
  return { commit, parent };
}

/** Read a snapshot back into a checkout as working-tree dirt.
 *
 * The second command is what makes this a restore rather than a checkout.
 * `read-tree -u --reset` puts the snapshot's files on disk *and* in the index,
 * which would leave everything staged — the user would come back to a tree
 * where `git diff` was empty and `git diff --cached` held all their work.
 * `reset --mixed HEAD` then rewinds the index alone: the files stay exactly as
 * they are, and what was modified reads as modified, what was deleted reads as
 * deleted, and what was never tracked reads as untracked.
 *
 * Unconditional by design — the caller decides whether applying is safe (see
 * `restoreWorktree`), because on a stale snapshot this is precisely the
 * command that would destroy newer work. */
export async function applyWip(worktreePath: string, ref: string): Promise<void> {
  const read = await gitSpawn(worktreePath, ["read-tree", "-u", "--reset", ref], {
    captureStderr: true,
  });
  if (read.exitCode !== 0) {
    throw new WorktreeError("wip-apply-failed", `could not read ${ref} into the checkout`, read.stderr);
  }
  const reset = await gitSpawn(worktreePath, ["reset", "--mixed", "--quiet", "HEAD"], {
    captureStderr: true,
  });
  if (reset.exitCode !== 0) {
    // Loud rather than absorbed: the files are already on disk at this point,
    // so a failure here does not lose work — it leaves it all staged, which
    // looks like the user made a giant commit-in-waiting they did not.
    throw new WorktreeError("wip-apply-failed", "could not unstage the restored tree", reset.stderr);
  }
}

/** Forget a task's snapshot.
 *
 * Deleting the ref is the whole of it: nothing else points at the commit, and
 * `refs/codetoaster/*` gets no reflog — git only logs updates under
 * `refs/heads`, `refs/remotes`, `refs/notes` and HEAD by default — so once the
 * ref is gone the objects are unreachable and the next `gc` takes them.
 *
 * `dir` is any checkout of the repository, not necessarily its root. The ref
 * store is shared between a repository's worktrees — only HEAD, `refs/bisect`,
 * `refs/worktree` and `refs/rewritten` are per-worktree — so a caller holding
 * the restored checkout and not the repo root can pass that.
 *
 * Idempotent. A ref that is not there is the state this asks for. */
export async function dropWip(dir: string, taskId: string): Promise<void> {
  await gitSpawn(dir, ["update-ref", "-d", wipRefFor(taskId)]);
}
