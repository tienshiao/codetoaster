import * as os from "os";
import * as path from "path";
import { gitSpawn } from "../../api/utils";
import { formatDerivedName } from "../xtmux/naming";

// Deriving a title must never be the reason a task fails to open. git may be
// missing from the daemon's PATH — Bun.spawn throws outright rather than
// exiting 127 — and a git on a stalled network mount or contending for
// index.lock can hang indefinitely. Either way the task falls back to its
// directory alone.
const GIT_LOOKUP_TIMEOUT_MS = 2000;

// The directory half of a derived title. The home directory and the root
// both basename to something useless ("tma", ""), so they get spelled out.
export function dirLabel(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;
  // Resolve first: expandTilde("~/") yields a trailing separator, which would
  // otherwise slip past the home-directory check and basename to "tma".
  const resolved = path.resolve(cwd);
  if (resolved === os.homedir()) return "~";
  return path.basename(resolved) || "/";
}

// The budget is for the whole lookup, not per command: a detached HEAD costs
// two git calls, and racing each one separately would let a wedged repo hold
// task creation for twice as long. gitSpawn kills the child it gives up on,
// so nothing is left running behind us.
export async function branchLabel(cwd: string): Promise<string | undefined> {
  const deadline = Date.now() + GIT_LOOKUP_TIMEOUT_MS;
  const remainingMs = () => Math.max(1, deadline - Date.now());
  try {
    const head = await gitSpawn(cwd, ["rev-parse", "--abbrev-ref", "HEAD"], {
      timeoutMs: remainingMs(),
    });
    if (head.exitCode !== 0) return undefined;
    const branch = head.stdout.trim();
    if (!branch) return undefined;
    // Detached HEAD reports the literal "HEAD", which says less than the short
    // sha it is sitting on.
    if (branch !== "HEAD") return branch;
    const short = await gitSpawn(cwd, ["rev-parse", "--short", "HEAD"], {
      timeoutMs: remainingMs(),
    });
    return short.exitCode === 0 ? short.stdout.trim() || undefined : undefined;
  } catch {
    return undefined;
  }
}

/** The "<dir> · <branch>" label a task carries until something better is known. */
export async function deriveTitle(cwd: string): Promise<string> {
  return formatDerivedName(dirLabel(cwd), await branchLabel(cwd));
}

// Resolved once, at creation, and stored on the row (§5.4). A harvested task
// has no process to ask, and re-deriving this from a live PTY is exactly what
// made every data route depend on one.
export async function resolveRepoRoot(cwd: string): Promise<string> {
  try {
    const result = await gitSpawn(cwd, ["rev-parse", "--show-toplevel"], {
      timeoutMs: GIT_LOOKUP_TIMEOUT_MS,
    });
    if (result.exitCode === 0) {
      const root = result.stdout.trim();
      if (root) return root;
    }
  } catch {
    // ignore
  }
  // Not a repository, or git is unavailable. The task still has a directory,
  // and the routes that need a repo will say so themselves.
  return cwd;
}
