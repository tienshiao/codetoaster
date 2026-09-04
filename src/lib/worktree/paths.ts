import * as os from "os";
import * as path from "path";
import { taskDir } from "../agent/spawn";
import { WorktreeError } from "./errors";

/** Where a project's worktrees live: outside every repository, so a checkout
 * we created never shows up in the user's own `git status` and no `.gitignore`
 * has to know about us (docs/v2-architecture.md §5.6). */
export function worktreesRoot(): string {
  return path.join(os.homedir(), ".codetoaster", "worktrees");
}

/** A task's checkout. Derived from **ids, and never from slugs or titles.**
 *
 * This is not a naming preference, it is the constraint the whole resume path
 * rests on. Claude Code keys a conversation's transcript on the escaped cwd,
 * so a directory that moved when its task was renamed would leave every
 * transcript filed under the old path: `--resume` would find nothing, and the
 * `--continue` fallback would be looking in a directory that had just become
 * empty. A rename is a cosmetic act and must stay one.
 *
 * The same rule is what makes evict and restore (§5.6) a round trip rather
 * than a move. Restore rebuilds the checkout at the path this returns, and it
 * has to be the path the conversation was recorded against — so this function
 * must give the same answer for the same task forever, however the task is
 * retitled in between. */
export function worktreePathFor(projectId: string, taskId: string): string {
  return path.join(worktreesRoot(), projectId, taskId);
}

/** Where a task's agent belongs inside its checkout: the checkout joined with
 * the project's offset below the toplevel, and the checkout itself for a
 * project pointing at the root (TASK-65).
 *
 * One function rather than a `path.join` at each end, because create and
 * restore have to agree about it forever — the restore rebuilds the directory
 * the transcript was filed under, and two spellings of the same join are two
 * things to keep in step. */
export function worktreeCwd(worktreePath: string, subdir: string): string {
  return path.join(worktreePath, subdir);
}

/** Refuse an offset that would not stay inside the checkout.
 *
 * Not reachable through git — the toplevel is found *from* the project's
 * directory, so it always contains it — but the value is joined onto a worktree
 * path, and both an absolute path and a leading `..` make that join land
 * somewhere that is not the checkout. `path.join` silently obeys either, so the
 * check has to happen before the value is ever stored. */
export function assertSubdir(subdir: string, projectPath: string, repoRoot: string): void {
  if (path.isAbsolute(subdir) || subdir.split(path.sep)[0] === "..") {
    throw new WorktreeError(
      "project-outside-repo",
      `${projectPath} is not inside ${repoRoot}`,
    );
  }
}

/** Whether a path is at or below the worktrees root.
 *
 * The one guard standing between the boot sweep and the rest of the disk
 * (TASK-32 AC #4), so it lives beside the function that composes the root
 * rather than in the caller — the same reasoning as `removeTaskDir`, which
 * checks the tasks root beside `taskDir`.
 *
 * `path.relative` and not a prefix test: `~/.codetoaster/worktrees-backup`
 * shares every character of the root's name and is not inside it. The root
 * itself answers `true`, so callers about to delete something exclude it
 * explicitly rather than reading a `false` here as protection. */
export function isWithinWorktreesRoot(candidate: string): boolean {
  const rel = path.relative(worktreesRoot(), path.resolve(candidate));
  return !path.isAbsolute(rel) && rel.split(path.sep)[0] !== "..";
}

/** Where the setup wrapper records what happened (see `setup.ts`). Beside the
 * task's settings.json and scrollback rather than inside the checkout: it is a
 * fact about the task, and putting it in the worktree would both pollute the
 * user's tree and be destroyed by the eviction whose grace period it feeds. */
export function setupStampPath(taskId: string): string {
  return path.join(taskDir(taskId), "setup.exit");
}
