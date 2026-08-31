import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { gitSpawn } from "../src/api/utils";
import { taskDir } from "../src/lib/agent/spawn";
import { worktreesRoot } from "../src/lib/worktree/paths";

// Scratch repositories for the worktree tests.
//
// Shared because `createWorktree` and the WIP snapshot need the same fixture —
// a repository with two branches and a commit on each — and because the
// *cleanup* is the part worth writing once. The worktrees these tests make
// land under the real `~/.codetoaster/worktrees`, the way they will at run
// time, so a file that forgets to remove them leaves checkouts in the user's
// home directory.

const tempDirs: string[] = [];
const projectIds: string[] = [];
const taskIds: string[] = [];

/** Run a git command that must succeed, and give back its output.
 *
 * Throwing rather than returning an exit code: this is fixture setup, and a
 * `git commit` that quietly did nothing produces a test failure ten lines
 * later that says nothing about the commit. */
export async function git(dir: string, ...args: string[]): Promise<string> {
  const { stdout, stderr, exitCode } = await gitSpawn(dir, args, { captureStderr: true });
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  return stdout.trim();
}

/** A registered scratch directory, removed with everything else at teardown.
 *
 * Handed out rather than made inline so that a test which needs a *path* — a
 * worktree destination git insists on creating itself — can delete it again
 * and still have it cleaned up if the test fails halfway. */
export function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** A repository with one commit on `main`, and a second commit on a branch, so
 * a test can tell "branched from the ref I asked for" from "branched from
 * whatever HEAD was". */
export async function tempRepo(): Promise<{ root: string; mainSha: string; otherSha: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-repo-"));
  tempDirs.push(root);
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.email", "test@example.com");
  await git(root, "config", "user.name", "Test");
  fs.writeFileSync(path.join(root, "README.md"), "on main\n");
  await git(root, "add", "-A");
  await git(root, "commit", "-m", "first");
  const mainSha = await git(root, "rev-parse", "HEAD");

  await git(root, "checkout", "-q", "-b", "other");
  fs.writeFileSync(path.join(root, "README.md"), "on other\n");
  await git(root, "commit", "-qam", "second");
  const otherSha = await git(root, "rev-parse", "HEAD");
  await git(root, "checkout", "-q", "main");

  return { root, mainSha, otherSha };
}

/** A stand-in project row, registered so its worktrees are cleaned up. */
export function tempProject(
  root: string,
  overrides: { worktree_copy?: string | null } = {},
): { id: string; initial_path: string; worktree_copy: string | null } {
  const id = `proj-${crypto.randomUUID()}`;
  projectIds.push(id);
  return { id, initial_path: root, worktree_copy: overrides.worktree_copy ?? null };
}

/** A stand-in task row. The id is what fixes the worktree path and the WIP ref,
 * so it is a fresh uuid per task exactly as it is at run time.
 *
 * Registered as well as returned: a task owns a directory under
 * `~/.codetoaster/tasks/` — the snapshot's scratch index goes there — and the
 * suite should not leave a hundred of them in the user's home. */
export function tempTask(title: string): { id: string; title: string } {
  const id = `task-${crypto.randomUUID()}`;
  taskIds.push(id);
  return { id, title };
}

/** Every checkout under the real worktrees root that this suite did not make.
 *
 * The boot sweep takes no root to work in: there is one, `~/.codetoaster/
 * worktrees`, and it walks it. So a test that ran the sweep with an empty
 * `claimed` set would be asking it to delete whatever the developer running the
 * suite happens to have checked out — the sweep cannot tell a genuine orphan
 * from one belonging to a database it was never handed, and a *clean* orphan is
 * precisely what it removes without asking. Feeding every foreign directory
 * back in as claimed makes the sweep a no-op on all of them, and leaves each
 * test reasoning only about the checkouts it made itself.
 *
 * Two levels, matching the `<projectId>/<taskId>` shape the sweep enumerates:
 * anything shallower is a project directory and anything deeper is the inside
 * of a checkout. Read at the moment it is asked for rather than cached, because
 * the tests create their own directories as they go and the answer has to be
 * about the disk as the sweep will find it. */
export function foreignCheckouts(ours: Iterable<string> = projectIds): string[] {
  const mine = new Set(ours);
  const root = worktreesRoot();
  const found: string[] = [];
  let projects: fs.Dirent[];
  try {
    projects = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    // No root at all: an install that has never made a worktree, which is the
    // state a fresh checkout of this repository is in.
    return found;
  }
  for (const project of projects) {
    if (!project.isDirectory() || mine.has(project.name)) continue;
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

/** Remove every repository and worktree this module handed out.
 *
 * Called from each test file's own `afterEach` rather than registered here:
 * a hook that ran because a module was imported would be invisible at the
 * point it matters, and the one thing this has to be is reliable. */
export function cleanupRepos(): void {
  for (const id of projectIds.splice(0)) {
    fs.rmSync(path.join(worktreesRoot(), id), { recursive: true, force: true });
  }
  for (const id of taskIds.splice(0)) {
    fs.rmSync(taskDir(id), { recursive: true, force: true });
  }
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}
