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
//
// Null when the directory is not in a repository. Falling back to the cwd
// would be worse than saying nothing: it reads as a repository right up until
// every git command inside it fails, and the data routes owe the client a 400
// rather than a directory that looks fine.
//
// `undefined` is the third answer, and a different thing entirely: the lookup
// could not be performed — git missing from PATH (Bun.spawn throws), a stalled
// network mount, a contended index.lock that outran the timeout. That must not
// be written to the row as "no repository", because the row is what every data
// route reads and nothing re-resolves it while the directory stays put; one
// slow git call would otherwise 400 the task's diff, file and git views for
// good. Callers keep whatever root they already had.
export async function resolveRepoRoot(cwd: string): Promise<string | null | undefined> {
  try {
    const result = await gitSpawn(cwd, ["rev-parse", "--show-toplevel"], {
      timeoutMs: GIT_LOOKUP_TIMEOUT_MS,
    });
    if (result.exitCode === 0) return result.stdout.trim() || null;
    // 128 is git's "not a git repository", which is an answer. Anything else —
    // 143 from the timeout kill above included — means we never got one.
    return result.exitCode === 128 ? null : undefined;
  } catch {
    return undefined;
  }
}
