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
   *
   * Not watched recursively; see `TaskWatcher`'s constructor. The common dir
   * is shared by every worktree of the repository, so a recursive stream on it
   * delivers every object every task writes to every other task's watcher.
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
 * about every other task's edits. It is listed here and not left to the ignore
 * file because it is genuinely not ignored: Claude Code puts linked worktrees
 * at `<repo>/.claude/worktrees/*`, and this repository's own `ls-files -o`
 * duly lists them.
 *
 * The cheap synchronous half. Everything else a view would not show —
 * `dist/`, `target/`, `coverage/` — is dropped at flush time by the
 * repository's own ignore rules, which cost a `git check-ignore` and so are
 * asked once per batch rather than once per event.
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
 *
 * The checkout is watched recursively; the metadata directories are not. A
 * repository's common dir is shared by all of its worktrees, so a recursive
 * stream on it hands every task's watcher every object written by every
 * commit, fetch and gc in the repository — N tasks' worth of events, all of
 * them discarded by `isHistoryPath`. What that predicate accepts lives in
 * exactly two places, so those are what is opened: the dir itself, shallow,
 * for `HEAD`, `ORIG_HEAD`, `packed-refs` and a `refs` entry appearing, and
 * `refs/` recursively when it is already there.
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
  /** The tail of the delivery chain; see `flush`. */
  private delivery: Promise<void> = Promise.resolve();

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
      this.open(roots.checkout, { recursive: true }, (rel) => {
        if (isReportableCheckoutPath(rel)) this.noteFile(rel);
      });
      const history = (rel: string) => {
        if (isHistoryPath(rel)) this.noteHistory();
      };
      for (const dir of roots.gitDirs) {
        this.open(dir, { recursive: false }, history);
        // The prefix is what makes the two streams speak one vocabulary: paths
        // from this one are relative to `refs/`, and `isHistoryPath` is written
        // against the metadata directory's own.
        const refs = path.join(dir, "refs");
        if (fs.existsSync(refs)) this.open(refs, { recursive: true, prefix: "refs/" }, history);
      }
    } catch (error) {
      this.close();
      throw error;
    }
  }

  private open(
    dir: string,
    options: { recursive: boolean; prefix?: string },
    onPath: (rel: string) => void,
  ): void {
    const watcher = fs.watch(dir, { recursive: options.recursive }, (_event, filename) => {
      if (this.closed || filename === null) return;
      const name = String(filename);
      onPath((options.prefix ?? "") + (path.sep === "/" ? name : name.split(path.sep).join("/")));
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

  /** The pending state is reset synchronously, as it always was — the next
   * burst starts accumulating the moment this returns — but delivery is not,
   * because the ignore check is a `git check-ignore`. Batches are chained
   * rather than raced so that two bursts a second apart cannot arrive out of
   * order because the second's check finished first. */
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
    // The chain has to survive a link that throws — a consumer that raised, a
    // `git` that could not be spawned at all — or one bad batch would leave a
    // rejected promise that every later batch queues behind and never gets
    // past. That batch is lost; the watch is not.
    this.delivery = this.delivery.then(() => this.deliver(batch)).catch(() => {});
  }

  private async deliver(batch: ChangeBatch): Promise<void> {
    // `null` is the overflow, which nothing can filter: there is no list to
    // ask about, and the answer the client acts on is "everything".
    const files = batch.files === null ? null : await this.withoutIgnored(batch.files);
    // `close()` drops what is pending, and the await above is a window in
    // which it can happen.
    if (this.closed) return;
    if (!batch.history && files !== null && files.length === 0) return;
    this.onBatch({ files, history: batch.history });
  }

  /**
   * Drop the paths the repository is told to ignore.
   *
   * Every view a batch invalidates is gitignore-aware — the tree is
   * `ls-files --others --cached --exclude-standard`, the diff is `git diff`
   * plus `--cached` plus those same untracked files — so a build writing into
   * `dist/`, `.next/`, `target/` or `coverage/` invalidates the tree, the diff
   * and the search for content none of them would ever show, once per settle
   * window for the whole length of the build. One `check-ignore` per batch is
   * far cheaper than that.
   *
   * Fail open: exit 1 is "none of them", and anything else — no git, the
   * timeout, 128 from a repository being rewritten underneath — keeps every
   * path, because a file reported that needed no refetch costs one query and a
   * file dropped that needed it costs a view that is quietly wrong. Tracked
   * files are safe by construction: `check-ignore` consults the index and does
   * not call a tracked path ignored, however the ignore rules read. A path
   * that has just been deleted is still answered for, from the rules alone,
   * so a removal inside `dist/` is dropped and one in `src/` is not.
   *
   * Paths go as arguments and the answers come back a line each. `-z` is not
   * an option here — git rejects it outright unless the paths arrive on stdin,
   * which `gitSpawn` cannot offer — so `core.quotePath=false` stands in for
   * most of what it would have bought: without it every non-ASCII name comes
   * back C-quoted and matches nothing. What remains unrepresentable is a
   * filename containing a literal newline, which git quotes regardless; that
   * line matches no path in the batch, so the file is kept, which is the side
   * to be wrong on.
   */
  private async withoutIgnored(files: string[]): Promise<string[]> {
    if (files.length === 0 || this.roots.gitDirs.length === 0) return files;
    const { stdout, exitCode } = await gitSpawn(
      this.roots.checkout,
      // A batch is capped at `maxFiles` entries, well inside any argv limit.
      ["-c", "core.quotePath=false", "check-ignore", "--", ...files],
      { timeoutMs: 5000 },
    );
    if (exitCode !== 0) return files;
    const ignored = new Set(stdout.split("\n").filter((p) => p !== ""));
    return ignored.size === 0 ? files : files.filter((file) => !ignored.has(file));
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
