import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { gitSpawn, safePath } from "../../api/utils";
import type { ProjectRow, TaskRow } from "../db";
import { allocateBranch } from "./branch";
import { WorktreeError } from "./errors";
import { withRepoLock } from "./lock";
import { worktreePathFor } from "./paths";
import { assertPathFree, lockKeyFor, repoRootOf } from "./repo";

// Creating a task's worktree (docs/v2-architecture.md §5.6). The checkout is a
// materialized cache of the branch: this module makes one, and everything that
// matters about it — the branch, and later the WIP ref — survives it being
// thrown away.

/** What creation needs off a project row. Narrower than `ProjectRow` so a test
 * can build one, and so it is obvious that nothing here reads project state
 * that could have changed since the task was created. */
export type WorktreeProject = Pick<ProjectRow, "id" | "initial_path" | "worktree_copy">;

/** What creation needs off a task row: the id that fixes the path, and the
 * title that names the branch. */
export type WorktreeTask = Pick<TaskRow, "id" | "title">;

export interface CreatedWorktree {
  worktreePath: string;
  branch: string;
  /** The `worktree_copy` entries that were actually copied, for a caller that
   * wants to report what the checkout did and did not get. Absent sources are
   * left out rather than failing the create — a fresh clone with no `.env` is
   * the ordinary case, not a broken project. */
  copied: string[];
}

/** Whether the base ref names a commit, asked before `worktree add` rather
 * than discovered from it. git's own failure for a bad ref is perfectly clear,
 * but it arrives mixed in with every other reason an add can fail — and this
 * is the one the user can fix, so it is worth naming on its own. */
async function assertBaseRef(repoRoot: string, baseRef: string): Promise<void> {
  // `^{commit}` and not a bare rev-parse: a ref that resolves to a tag object
  // or a tree is a thing that exists and is still not something to branch
  // from, and `--verify --quiet` turns "no such ref" into a clean exit code
  // rather than a message we would have to match on.
  const { exitCode, stderr } = await gitSpawn(
    repoRoot,
    ["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`],
    { captureStderr: true },
  );
  if (exitCode !== 0) {
    throw new WorktreeError("bad-base-ref", `${baseRef} does not name a commit`, stderr);
  }
}

/** The `worktree_copy` entries, one per line.
 *
 * Newline-separated and nothing else. Commas are tempting as a second
 * separator and are wrong: a filename may contain one, and a list format that
 * is sometimes ambiguous is worse than one that is always strict. */
export function parseCopyList(worktreeCopy: string | null): string[] {
  if (!worktreeCopy) return [];
  return worktreeCopy.split("\n").map((line) => line.trim()).filter(Boolean);
}

/** Copy the project's ignored-but-needed files into the new checkout.
 *
 * These are load-bearing rather than a convenience (§5.6): the WIP snapshot
 * that makes eviction safe is built with `git add -A`, which honours
 * `.gitignore`, so an ignored `.env` or a build directory does not survive an
 * evict/restore round trip. This and `setup_command` are what put them back.
 *
 * Both ends are contained with `safePath`. The list is project configuration
 * rather than user input at the moment, but it is edited in a text field and
 * `../../.ssh/id_rsa` reads out of the project and writes into somewhere that
 * is not the worktree — a containment check costs a `path.resolve`. */
async function copyProjectFiles(
  project: WorktreeProject,
  projectRoot: string,
  worktreePath: string,
): Promise<string[]> {
  const copied: string[] = [];
  for (const entry of parseCopyList(project.worktree_copy)) {
    const from = safePath(projectRoot, entry);
    const to = safePath(worktreePath, entry);
    if (!from || !to) {
      throw new WorktreeError("copy-failed", `worktree_copy entry escapes the project: ${entry}`);
    }
    if (!fs.existsSync(from)) continue;
    try {
      await fsp.mkdir(path.dirname(to), { recursive: true });
      // Recursive so an entry may be a directory — `.claude/`, a `vendor/`
      // tree — and not only a single dotfile.
      await fsp.cp(from, to, { recursive: true });
      copied.push(entry);
    } catch (e) {
      throw new WorktreeError("copy-failed", `could not copy ${entry}`, String(e));
    }
  }
  return copied;
}

/** Make a task its own checkout, branched from `baseRef`.
 *
 * Everything below runs inside one per-repository critical section
 * (`withRepoLock`), and the branch *read* is the reason. Choosing a name means
 * listing the branches under our prefix and taking the first free suffix, so
 * two creates that both list before either writes both choose the same name
 * and the second `worktree add` fails on a branch that exists. Holding the
 * lock only around git's own call would leave exactly that race in place.
 *
 * The copy is inside it too, and that is not about contention: a create either
 * produces a worktree set up the way the project asked, or it produces none.
 * Undoing a partial one means `git worktree remove`, which mutates the same
 * worktree list, so the cleanup has to hold the lock the create did. */
export function createWorktree(
  project: WorktreeProject,
  task: WorktreeTask,
  baseRef: string,
): Promise<CreatedWorktree> {
  return repoRootOf(project.initial_path).then(async (repoRoot) =>
    withRepoLock(await lockKeyFor(repoRoot), async () => {
      const worktreePath = worktreePathFor(project.id, task.id);
      await assertBaseRef(repoRoot, baseRef);
      assertPathFree(worktreePath);
      const branch = await allocateBranch(repoRoot, task);

      // git creates the leaf itself; the two levels above it are ours and are
      // not there for the first task in a project.
      await fsp.mkdir(path.dirname(worktreePath), { recursive: true });
      // `--force` for one narrow case: a path git still has registered in
      // `.git/worktrees` while the directory itself is gone — what an eviction
      // that reclaimed the disk (§5.6), or a user with `rm -rf`, leaves
      // behind. git refuses that outright and names `-f` as the remedy, and
      // without it the task's path — fixed by its id, and unmovable
      // (`paths.ts`) — would be poisoned for good. It relaxes nothing else
      // here: the non-empty-directory case is `assertPathFree`'s and is
      // already refused above, and `-b` still fails on a branch that exists
      // whether or not `-f` is passed.
      const add = await gitSpawn(
        repoRoot,
        ["worktree", "add", "--force", worktreePath, "-b", branch, baseRef],
        { captureStderr: true },
      );
      if (add.exitCode !== 0) {
        throw new WorktreeError(
          "worktree-add-failed",
          `could not create a worktree for ${task.id}`,
          add.stderr,
        );
      }

      try {
        const copied = await copyProjectFiles(project, repoRoot, worktreePath);
        return { worktreePath, branch, copied };
      } catch (e) {
        // Back out to nothing rather than leaving a checkout the project's
        // setup would run against a half-copied tree.
        await discard(repoRoot, worktreePath, branch);
        throw e;
      }
    }),
  );
}

/** Take a checkout and its branch back off disk.
 *
 * `--force` because the tree may hold files git does not know about — the
 * `worktree_copy` entries, anything setup wrote — which is exactly what
 * `worktree remove` refuses to discard on its own.
 *
 * Checked rather than fired and forgotten, because "or it produces none" is a
 * promise and a `worktree remove` that fails breaks it twice over: the
 * checkout stays, and `branch -D` then fails too — the branch is still checked
 * out in it — so the name is burned and the next create for the same title
 * gets a `-2` it did not earn. Deleting the directory ourselves and pruning
 * the registration it leaves is the same end state by a blunter route. */
async function discard(repoRoot: string, worktreePath: string, branch: string): Promise<void> {
  const removed = await gitSpawn(repoRoot, ["worktree", "remove", "--force", worktreePath]);
  if (removed.exitCode !== 0) {
    await fsp.rm(worktreePath, { recursive: true, force: true }).catch(() => {});
    await gitSpawn(repoRoot, ["worktree", "prune"]);
  }
  await gitSpawn(repoRoot, ["branch", "-D", branch]);
}

/** Undo a `createWorktree` from outside it.
 *
 * The create is only half of "a task either gets a checkout or it does not":
 * the caller goes on to write a row and spawn an agent, and either of those
 * can still fail. Without this, a `$SHELL` that is no longer on PATH would
 * leave a checkout and a branch behind for a task that does not exist — and
 * the branch name, allocated from the title, would make the next attempt at
 * the same task a `-2`.
 *
 * Takes the project's directory rather than a repo root for the same reason
 * `createWorktree` does: the caller has the project, not the repository. Runs
 * under the same per-repository lock, because removing a worktree mutates the
 * list branch allocation reads. */
export async function removeWorktree(
  projectPath: string,
  worktreePath: string,
  branch: string,
): Promise<void> {
  const repoRoot = await repoRootOf(projectPath);
  await withRepoLock(await lockKeyFor(repoRoot), () => discard(repoRoot, worktreePath, branch));
}
