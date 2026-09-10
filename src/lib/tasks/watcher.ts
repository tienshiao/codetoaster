import * as fs from "fs";
import * as path from "path";
import { gitSpawn } from "../../api/utils";

/**
 * What tells a client its view of a task's checkout is stale (TASK-103).
 *
 * Nothing in the browser used to notice a file being edited or a commit being
 * made: the file, tree, diff and log queries were fetched once and kept. This
 * is the server half of the fix — a recursive `fs.watch` on the checkout and on
 * the repository's metadata, coalesced into one small message per burst that
 * says *what kind* of thing changed and, when it is short enough to be useful,
 * which files. The client half (`change-invalidation.ts`) turns that into
 * query invalidations. Neither side re-reads anything on its own: a refetch is
 * the client's, for the views it has mounted.
 *
 * Bun on macOS reports every event as `rename` whatever actually happened, so
 * the event kind is never read. The path is the whole signal.
 */

/** One flush of a task's watcher. */
export interface ChangeBatch {
  /**
   * Checkout-relative paths, with the platform's separators normalised to `/`.
   * `null` is "more than `maxFiles` in one burst", which is a checkout or a
   * dependency install rather than an edit, and the honest answer is that
   * everything may have changed. Empty when only history moved.
   */
  files: string[] | null;
  /** HEAD or a ref moved: a commit, a checkout, a rebase, a fetch. */
  history: boolean;
}

export interface WatchRoots {
  checkout: string;
  /**
   * The repository's metadata directories, deduplicated: the task's own — for
   * a linked worktree that is `<main>/.git/worktrees/<name>` — and the common
   * one, where shared refs live. Empty when the checkout is not a repository,
   * in which case only the files are watched.
   */
  gitDirs: string[];
}

/** How long a burst has to go quiet before it is reported. An agent writing a
 * file writes it once; a formatter or a checkout writes hundreds within a few
 * hundred milliseconds, and the point is to report those as one. */
export const SETTLE_MS = 250;
/** How long a burst can keep resetting the settle timer before a batch goes
 * out anyway. A long install would otherwise report nothing until it ended. */
export const MAX_WAIT_MS = 1000;
/** Past this many paths in one batch the list is replaced with `null`. */
export const MAX_FILES = 200;

/**
 * Whether a checkout-relative path is a file change worth reporting.
 *
 * `.git` is anywhere in the path rather than only at the root: a submodule or
 * a nested clone has its own, and none of them is the user's work. The
 * metadata that matters is watched separately, by `classifyGitPath`.
 * `.claude/worktrees` is the case that would otherwise be spectacular — the
 * main checkout contains every other worktree, so a task there would be told
 * about every other task's edits.
 */
export function isReportableCheckoutPath(rel: string): boolean {
  if (!rel) return false;
  const segments = rel.split("/");
  for (const segment of segments) {
    if (segment === ".git" || segment === "node_modules") return false;
  }
  if (segments[0] === ".claude" && segments[1] === "worktrees") return false;
  return true;
}

/**
 * Whether a path under a metadata directory means history moved.
 *
 * Only the places a ref or HEAD is written: `objects/` fills on every commit
 * and every fetch long before anything points at the new objects; `logs/` is
 * the reflog, written alongside the ref it mirrors; `worktrees/` under the
 * common dir is other checkouts' HEADs, and the task's own is watched as its
 * own root. `*.lock` is the staging file git renames over the real one, and
 * the rename produces an event on the real name.
 *
 * `index` is left out deliberately, and not because staging is uninteresting
 * — the diff route reads `--cached`. It is that the server's own `git diff`
 * and `git status` refresh the index's stat cache as a side effect, so an
 * index event that invalidated the diff would have the refetch write the very
 * file whose change it was answering. A `git add` with no edit behind it is
 * the one thing this misses; an edit that is then staged was already reported
 * by the edit.
 */
export function isHistoryPath(rel: string): boolean {
  if (!rel || rel.endsWith(".lock")) return false;
  if (rel === "HEAD" || rel === "ORIG_HEAD" || rel === "packed-refs") return true;
  return rel === "refs" || rel.startsWith("refs/");
}

/** The roots a task's watcher covers, from where its checkout is. */
export async function watchRootsFor(checkout: string): Promise<WatchRoots> {
  const { stdout, exitCode } = await gitSpawn(
    checkout,
    ["rev-parse", "--git-dir", "--git-common-dir"],
    { timeoutMs: 5000 },
  );
  if (exitCode !== 0) return { checkout, gitDirs: [] };
  const gitDirs: string[] = [];
  for (const line of stdout.split("\n")) {
    const answer = line.trim();
    if (!answer) continue;
    // Relative when the checkout is the repository's own directory (`.git`),
    // absolute for a linked worktree. Resolved so the two compare.
    const dir = path.resolve(checkout, answer);
    if (!gitDirs.includes(dir) && fs.existsSync(dir)) gitDirs.push(dir);
  }
  return { checkout, gitDirs };
}

export interface TaskWatcherOptions {
  settleMs?: number;
  maxWaitMs?: number;
  maxFiles?: number;
  /**
   * The watch died — an `EMFILE`, a root removed under it. Called once, after
   * the watcher has closed itself; there is nothing to recover from here, and
   * the task goes on without refresh until something restarts it.
   */
  onError?: (error: Error) => void;
}

/**
 * The watch on one task's roots, coalescing events into `ChangeBatch`es.
 *
 * Construction is synchronous and throws if a root cannot be watched, with
 * everything it did manage to open closed again first: a watcher that is half
 * up is worse than none, because it would report edits and miss commits.
 */
export class TaskWatcher {
  private readonly watchers: fs.FSWatcher[] = [];
  private readonly settleMs: number;
  private readonly maxWaitMs: number;
  private readonly maxFiles: number;
  private readonly onError: ((error: Error) => void) | undefined;

  private files = new Set<string>();
  private overflowed = false;
  private history = false;
  private settle: ReturnType<typeof setTimeout> | null = null;
  private cap: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    readonly roots: WatchRoots,
    private readonly onBatch: (batch: ChangeBatch) => void,
    options: TaskWatcherOptions = {},
  ) {
    this.settleMs = options.settleMs ?? SETTLE_MS;
    this.maxWaitMs = options.maxWaitMs ?? MAX_WAIT_MS;
    this.maxFiles = options.maxFiles ?? MAX_FILES;
    this.onError = options.onError;
    try {
      this.open(roots.checkout, (rel) => {
        if (isReportableCheckoutPath(rel)) this.noteFile(rel);
      });
      for (const dir of roots.gitDirs) {
        this.open(dir, (rel) => {
          if (isHistoryPath(rel)) this.noteHistory();
        });
      }
    } catch (error) {
      this.close();
      throw error;
    }
  }

  private open(dir: string, onPath: (rel: string) => void): void {
    const watcher = fs.watch(dir, { recursive: true }, (_event, filename) => {
      if (this.closed || filename === null) return;
      const name = String(filename);
      onPath(path.sep === "/" ? name : name.split(path.sep).join("/"));
    });
    watcher.on("error", (error: Error) => this.fail(error));
    this.watchers.push(watcher);
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.close();
    this.onError?.(error);
  }

  private noteFile(rel: string): void {
    if (!this.overflowed) {
      this.files.add(rel);
      if (this.files.size > this.maxFiles) {
        this.overflowed = true;
        this.files.clear();
      }
    }
    this.arm();
  }

  private noteHistory(): void {
    this.history = true;
    this.arm();
  }

  /** Every event pushes the settle timer back; only the first arms the cap. */
  private arm(): void {
    if (this.settle) clearTimeout(this.settle);
    this.settle = setTimeout(() => this.flush(), this.settleMs);
    if (!this.cap) this.cap = setTimeout(() => this.flush(), this.maxWaitMs);
  }

  private flush(): void {
    if (this.settle) clearTimeout(this.settle);
    if (this.cap) clearTimeout(this.cap);
    this.settle = null;
    this.cap = null;
    if (this.closed) return;
    if (!this.history && !this.overflowed && this.files.size === 0) return;
    const batch: ChangeBatch = {
      files: this.overflowed ? null : [...this.files].sort(),
      history: this.history,
    };
    this.files = new Set();
    this.overflowed = false;
    this.history = false;
    this.onBatch(batch);
  }

  /** Idempotent. Anything pending is dropped rather than flushed: a task that
   * is being suspended or deleted has nobody to tell. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.settle) clearTimeout(this.settle);
    if (this.cap) clearTimeout(this.cap);
    this.settle = null;
    this.cap = null;
    for (const watcher of this.watchers.splice(0)) {
      try {
        watcher.close();
      } catch {
        // Already gone; that is what was wanted.
      }
    }
  }
}

export interface WatcherHandle {
  /** Resolves once the watch is up (`true`) or has been refused (`false`):
   * stopped before the roots were known, not a directory, out of descriptors.
   * Only tests wait on it; the manager fires and forgets. */
  readonly ready: Promise<boolean>;
  /** Idempotent, and safe before `ready`: a start that has not finished
   * discovering its roots is cancelled rather than closed. */
  stop(): void;
}

/**
 * Start watching a task's checkout, discovering the repository roots first.
 *
 * Discovery is a `git rev-parse`, so it is asynchronous, and the manager that
 * asks for a watcher may want it gone before the answer arrives — a task
 * suspended within a second of resuming. The handle absorbs that race: `stop`
 * flips a flag the resolution checks before it opens anything.
 */
export function startTaskWatcher(
  checkout: string,
  onBatch: (batch: ChangeBatch) => void,
  options: TaskWatcherOptions = {},
): WatcherHandle {
  let stopped = false;
  let watcher: TaskWatcher | null = null;
  const ready = watchRootsFor(checkout)
    .then((roots) => {
      if (stopped) return false;
      watcher = new TaskWatcher(roots, onBatch, options);
      return true;
    })
    .catch((error: unknown) => {
      if (!stopped) options.onError?.(error instanceof Error ? error : new Error(String(error)));
      return false;
    });
  return {
    ready,
    stop() {
      stopped = true;
      watcher?.close();
      watcher = null;
    },
  };
}
