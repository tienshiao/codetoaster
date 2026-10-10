import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Server } from "bun";
import { taskManager } from "../lib/tasks/manager";
import { expandTilde } from "../lib/tilde";

export interface TaskRoot {
  /** The repository the task's work lives in — where every git route runs. */
  repoRoot: string;
  /** The directory the task was started in. Equal to repoRoot for a task
   * opened at the top of its repo, and to the worktree path once §5.6 lands. */
  cwd: string;
}

// Read from the task row, never from a process (§5.4). A suspended task has no
// PTY to interrogate, and browsing a task you are not currently running is the
// whole point — so this asks the row, which also means the data routes stop
// shelling out to `rev-parse --show-toplevel` on every single request.
export async function resolveTaskRoot(taskId: string): Promise<TaskRoot | { error: Response }> {
  // Ask the terminal where it actually is, at most once every few seconds per
  // task (TASK-41). The row is the source of truth for these routes (§5.4),
  // and this is the only thing that keeps it true when the agent cd's — a
  // client re-attaches when it switches task, so a user working inside one
  // task's tabs would otherwise browse the repository it started in forever.
  await taskManager.refreshCwdIfStale(taskId).catch(() => {});
  const task = taskManager.getTask(taskId);
  if (!task) {
    return { error: Response.json({ error: "Task not found" }, { status: 404 }) };
  }
  // Null when the task's directory is not inside a repository, and every route
  // that reaches this helper needs one.
  if (task.repo_root === null) {
    return { error: Response.json({ error: "Not a git repository" }, { status: 400 }) };
  }
  return { repoRoot: task.repo_root, cwd: task.cwd };
}

/** One entry of a `cachedPromise` cache. */
export interface CachedPromise<T> {
  at: number;
  value: Promise<T>;
}

/**
 * `make()`, at most once per `ttlMs` for `key`.
 *
 * The *promise* is cached rather than its value, so requests arriving while
 * one is in flight share it instead of starting their own — the point, for
 * callers that would otherwise fork a git process per request for the same
 * answer. A rejection is evicted as soon as it lands, or the first failure
 * ("not a repository", most often) would be the answer for the rest of the
 * TTL after it stopped being true — but only while it is still the cached
 * entry, since a later request may already have replaced it.
 */
export function cachedPromise<T>(
  cache: Map<string, CachedPromise<T>>,
  key: string,
  ttlMs: number,
  make: () => Promise<T>,
): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;

  const value = make();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => {
    if (cache.get(key)?.value === value) cache.delete(key);
  });
  return value;
}

/** How long one project's `rev-parse --show-toplevel` stands in for the next. */
const PROJECT_TOPLEVEL_TTL_MS = 3000;
const projectToplevelCache = new Map<string, CachedPromise<string>>();

/**
 * The repository toplevel of `dir`, cached (`cachedPromise`): the Explorer
 * opens a project with five or six routes at once, each needing this answer.
 *
 * Inlined rather than borrowed from `lib/worktree/repo.ts`'s `repoRootOf`,
 * which imports `gitSpawn` from here.
 */
function cachedToplevel(dir: string): Promise<string> {
  return cachedPromise(projectToplevelCache, dir, PROJECT_TOPLEVEL_TTL_MS, () =>
    gitSpawn(dir, ["rev-parse", "--show-toplevel"]).then(({ stdout, exitCode }) => {
      const root = stdout.trim();
      if (exitCode !== 0 || !root) throw new Error(`Not a git repository: ${dir}`);
      return root;
    }),
  );
}

/**
 * A project's checkout as a `TaskRoot`: the directory a non-worktree task in
 * it would start in (`cwd`), and the repository that directory belongs to
 * (`repoRoot`).
 *
 * The composer has no task yet — the prompt is still being written — but its
 * Explorer shows the repository the task is going to run in, so every
 * repository-reading route answers for a project as well (see `rootRoutes`).
 *
 * A project with no directory ("General") and one whose directory is not a
 * repository are 400s rather than empty answers: they are facts about the
 * project, and the client decides whether they are worth showing.
 */
export async function resolveProjectRoot(projectId: string): Promise<TaskRoot | { error: Response }> {
  const project = taskManager.getProjects().find((p) => p.id === projectId);
  if (!project) {
    return { error: Response.json({ error: `Unknown project "${projectId}"` }, { status: 404 }) };
  }
  if (!project.initialPath) {
    return { error: Response.json({ error: "Project has no directory" }, { status: 400 }) };
  }
  const dir = expandTilde(project.initialPath);
  try {
    return { repoRoot: await cachedToplevel(dir), cwd: dir };
  } catch {
    // git fails the same way for a directory that is not a repository and one
    // that is not there at all, and the second is worth its own words: a
    // project whose path was moved or deleted is something the user can fix,
    // and "not a git repository" sends them looking for the wrong problem.
    if (!fs.existsSync(dir)) {
      return { error: Response.json({ error: "Project directory does not exist" }, { status: 400 }) };
    }
    return { error: Response.json({ error: "Not a git repository" }, { status: 400 }) };
  }
}

/** Which kind of id a repository-reading route was addressed by. */
export type RootScope = "tasks" | "projects";

export function resolveRoot(scope: RootScope, id: string): Promise<TaskRoot | { error: Response }> {
  return scope === "tasks" ? resolveTaskRoot(id) : resolveProjectRoot(id);
}

/** A route handler over a resolved root. `scope` is there for the rare route
 * whose answer depends on who asked — `files/search`, whose paths are written
 * into a prompt for an agent running in a project's `cwd`. `server` is Bun's,
 * for the rarer one that needs the peer's address (`reveal`). */
export type RootHandler = (
  root: TaskRoot,
  req: Request,
  scope: RootScope,
  server?: Server<unknown>,
) => Response | Promise<Response>;
type RootRouteMethod = (req: Request & { params: { id: string } }, server?: Server<unknown>) => Promise<Response>;

export interface RootRouteOptions {
  /** Rewrite the resolver's error Response before the client gets it — the
   * backlog route answers "no repository here" with `detected: false`. The
   * handler still never runs for an unresolved root. */
  onResolveError?: (error: Response) => Response;
}

/**
 * One handler, served under both `/api/tasks/:id/<subpath>` and
 * `/api/projects/:id/<subpath>`.
 *
 * Every repository-reading route used to be task-scoped, because a task was
 * the only thing with a directory. The composer needs the same Explorer —
 * files, diff, history, backlog — before any task exists, against the project
 * the prompt will run in. The handlers do not care how the directory was
 * found, so each is written once against a `TaskRoot`, and this resolves the
 * root for its scope before calling it; a root that cannot be resolved is
 * answered here (404/400) and the handler never runs.
 */
export function rootRoutes(
  subpath: string,
  methods: { GET?: RootHandler; POST?: RootHandler },
  options: RootRouteOptions = {},
): Record<string, Record<string, RootRouteMethod>> {
  const scoped = (scope: RootScope): Record<string, RootRouteMethod> => {
    const table: Record<string, RootRouteMethod> = {};
    for (const [method, handler] of Object.entries(methods)) {
      if (!handler) continue;
      table[method] = async (req, server) => {
        const result = await resolveRoot(scope, req.params.id);
        if ("error" in result) {
          return options.onResolveError ? options.onResolveError(result.error) : result.error;
        }
        return handler(result, req, scope, server);
      };
    }
    return table;
  };
  return {
    [`/api/tasks/:id/${subpath}`]: scoped("tasks"),
    [`/api/projects/:id/${subpath}`]: scoped("projects"),
  };
}

export const IMAGE_MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  ico: "image/x-icon",
  bmp: "image/bmp",
  tiff: "image/tiff",
  tif: "image/tiff",
};

export function getImageMimeType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  return IMAGE_MIME_TYPES[ext] || "application/octet-stream";
}

export async function listGitFiles(dir: string, { cached = true }: { cached?: boolean } = {}): Promise<string[]> {
  // gitSpawn rather than Bun.$ for the reason spelled out below: this lists a
  // whole repository, and it is on a per-keystroke path now that the composer
  // and the palette both search through it.
  const { stdout, exitCode } = await gitSpawn(dir, [
    "ls-files",
    "-z",
    "--others",
    ...(cached ? ["--cached"] : []),
    "--exclude-standard",
  ]);
  if (exitCode !== 0) throw new Error("Failed to list files");
  // -z outputs null-terminated paths, avoiding git's quoting of special characters
  return stdout.split("\0").filter(Boolean);
}

/**
 * What `listGitFiles` leaves out: the entries of `dir` the repository ignores
 * (TASK-130). A directory ends in `/` and stands for everything inside it.
 *
 * `--directory` is the point. An ignore rule usually names a directory, and
 * what is under one is the bulk of any checkout — `node_modules`, a build
 * directory, other tasks' worktrees — so git is asked for the directory and
 * never walks into it. That keeps this the size of the ignore file rather than
 * of the disk, and as quick as the listing it sits beside.
 *
 * One shape needs taking back out. For a directory no rule names but which
 * holds nothing except ignored files, git lists the directory *and* the files
 * (`out/` beside `out/a.log`, under `*.log`). That directory is an ordinary
 * one, and reported as ignored it would stand in for the files it was listed
 * for, so an entry that is the parent of another is dropped. `--no-empty-
 * directory` looks like the flag for this and is not: it also drops ignored
 * directories that have files in them.
 */
export async function listIgnoredEntries(dir: string): Promise<string[]> {
  const { stdout, exitCode } = await gitSpawn(dir, [
    "ls-files",
    "-z",
    "--others",
    "--ignored",
    "--exclude-standard",
    "--directory",
  ]);
  if (exitCode !== 0) throw new Error("Failed to list ignored files");
  const entries = stdout.split("\0").filter(Boolean);
  const parents = new Set<string>();
  for (const entry of entries) {
    for (let slash = entry.indexOf("/"); slash >= 0 && slash < entry.length - 1; slash = entry.indexOf("/", slash + 1)) {
      parents.add(entry.slice(0, slash + 1));
    }
  }
  return parents.size === 0 ? entries : entries.filter((entry) => !parents.has(entry));
}

// Run git via Bun.spawn (not Bun.$) so large output streams through a pipe
// rather than buffering in a shell — Bun.$ deadlocks when many concurrent shells
// each buffer large stdout (e.g. multi-MB files or patch output).
export interface GitSpawnOptions {
  // Kill the child if it has not exited within this many milliseconds. git can
  // block indefinitely — a stalled network mount, a contended index.lock — and
  // an abandoned child holds its stdout pipe for the life of the daemon.
  // Racing the promise is not enough: the loser keeps running.
  //
  // A killed child exits 143 (128 + SIGTERM), so the usual `exitCode !== 0`
  // check treats a timeout as a failed lookup without any special casing.
  timeoutMs?: number;
  // Keep git's stderr instead of discarding it. Off by default because the
  // read routes ask git questions whose failure *is* the answer — a path with
  // no history, a ref that is not there — and reading a pipe nobody wants is
  // work per call for a string thrown away.
  //
  // Worth it where a failure has to be reported rather than absorbed: git says
  // why in stderr and nowhere else, and "worktree add failed" without
  // "fatal: invalid reference: nosuchref" is a message the user can do nothing
  // with (TASK-29).
  captureStderr?: boolean;
  // Extra environment for the child, merged over the daemon's own.
  //
  // Two callers need it and both are the WIP snapshot (§5.6). `GIT_INDEX_FILE`
  // is the whole reason the snapshot can be taken without touching the live
  // tree: it points `read-tree`/`add`/`write-tree` at a throwaway index, and it
  // cannot be passed as a flag because git only reads it from the environment.
  // `GIT_AUTHOR_*`/`GIT_COMMITTER_*` are the second: `commit-tree` refuses to
  // build a commit with no identity — `user.useConfigOnly = true` is a real
  // configuration and it fails there — and a snapshot of someone's scratch
  // work is ours rather than theirs, so it should not carry their name.
  env?: Record<string, string>;
  // Text to feed the child on stdin, for the commands that take their input
  // there rather than in argv — `cat-file --batch-check`, which answers a whole
  // list of revisions in one spawn instead of one spawn each (TASK-110).
  //
  // Bun takes a Blob, not a string; with nothing here stdin is left at its
  // default, which is what every other caller wants.
  stdin?: string;
  // Stop reading, and kill the child, once stdout passes this many bytes. For
  // the one caller whose output has no natural bound: a commit diffed against
  // an arbitrary base (TASK-128), where an old tag on a large repository is
  // gigabytes of patch held as one string in the daemon every task's terminal
  // lives in. The result says `overflowed`, and its stdout is whatever fitted —
  // cut mid-line, so for reporting the fact rather than for parsing.
  maxStdoutBytes?: number;
}

/** A child's stdout as text, read until it ends or passes `maxBytes`. */
async function readCapped(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  onOverflow: () => void,
): Promise<{ text: string; overflowed: boolean }> {
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { text: text + decoder.decode(), overflowed: false };
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      onOverflow();
      await reader.cancel();
      return { text, overflowed: true };
    }
    text += decoder.decode(value, { stream: true });
  }
}

export async function gitSpawn(
  dir: string,
  args: string[],
  options?: GitSpawnOptions,
): Promise<{ stdout: string; stderr: string; exitCode: number; overflowed?: boolean }> {
  const capture = options?.captureStderr === true;
  const proc = Bun.spawn(["git", "-C", dir, ...args], {
    stdout: "pipe",
    stderr: capture ? "pipe" : "ignore",
    ...(options?.stdin !== undefined ? { stdin: new Blob([options.stdin]) } : {}),
    // Merged rather than replaced: Bun takes `env` as the child's whole
    // environment, and a git that lost PATH, HOME and the ssh-agent socket
    // would fail in ways that have nothing to do with what was asked of it.
    ...(options?.env ? { env: { ...process.env, ...options.env } } : {}),
  });
  const timer =
    options?.timeoutMs === undefined ? null : setTimeout(() => proc.kill(), options.timeoutMs);
  try {
    // Both pipes are drained in the same `Promise.all` as `exited`, and that is
    // not tidiness: a child whose stderr fills the pipe buffer blocks writing
    // to it, so awaiting `exited` first would hang on exactly the failure this
    // option exists to report — the verbose one.
    //
    // The kill ends every await here: the pipes hit EOF and `exited` resolves,
    // so this never outlives the child.
    const maxBytes = options?.maxStdoutBytes;
    const [out, stderr, exitCode] = await Promise.all([
      maxBytes === undefined
        ? new Response(proc.stdout).text().then((text) => ({ text, overflowed: false }))
        : readCapped(proc.stdout, maxBytes, () => proc.kill()),
      capture ? new Response(proc.stderr).text() : Promise.resolve(""),
      proc.exited,
    ]);
    return { stdout: out.text, stderr, exitCode, ...(out.overflowed ? { overflowed: true } : {}) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Raw-bytes variant of gitSpawn for blob content that must not be decoded as
// text (binary detection needs the raw bytes). Same rationale: Bun.spawn (not
// Bun.$) so large output streams through a pipe rather than buffering in a shell.
// `stdin` is for `cat-file --batch`, which is handed its list of objects there;
// `timeoutMs` kills a child that hangs, as in `gitSpawn`.
export async function gitSpawnRaw(
  dir: string,
  args: string[],
  options?: Pick<GitSpawnOptions, "stdin" | "timeoutMs">,
): Promise<{ bytes: Uint8Array; exitCode: number }> {
  const proc = Bun.spawn(["git", "-C", dir, ...args], {
    stdout: "pipe",
    stderr: "ignore",
    ...(options?.stdin !== undefined ? { stdin: new Blob([options.stdin]) } : {}),
  });
  const timer =
    options?.timeoutMs === undefined ? null : setTimeout(() => proc.kill(), options.timeoutMs);
  try {
    const [buffer, exitCode] = await Promise.all([new Response(proc.stdout).arrayBuffer(), proc.exited]);
    return { bytes: new Uint8Array(buffer), exitCode };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Parse a query param that must be a non-negative integer. Returns the default
// when absent, or null when present-but-invalid (caller responds 400).
export function parseNonNegInt(raw: string | null, def: number): number | null {
  if (raw === null) return def;
  if (!/^\d+$/.test(raw)) return null;
  return parseInt(raw, 10);
}

export const SHA_RE = /^[0-9a-f]{4,40}$/i;

// Diff a single untracked file against /dev/null. `git diff --no-index` exits
// non-zero when files differ, so the exit code is intentionally ignored. `--`
// because the name is whatever the user called the file, and one starting with
// a dash would otherwise be read as an option.
async function diffUntrackedFile(dir: string, file: string): Promise<string> {
  const { stdout } = await gitSpawn(dir, ["diff", "--no-index", "--", "/dev/null", file]);
  return stdout;
}

/** How many of the per-file fallback diffs may run at once. */
export const UNTRACKED_DIFF_CONCURRENCY = 16;

/** `Promise.all` with at most `limit` of the promises alive at a time.
 *
 * Results come back in input order whatever order they finished in. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** The diff of every untracked file against nothing, as `git diff` would show
 * it had each been staged as a new file — a fixed handful of processes for the
 * lot, however many there are (TASK-113).
 *
 * This used to be one `git diff --no-index /dev/null <file>` per untracked
 * file, all spawned at once. A checkout with a build directory that is not
 * ignored has thousands of untracked files, and since the checkout watcher
 * (TASK-103) refetches this diff on every burst of writes, a build in such a
 * checkout had the daemon forking thousands of gits a second for as long as
 * it ran.
 *
 * The trick is the one the WIP snapshot uses: `GIT_INDEX_FILE` pointed at a
 * scratch file. The scratch starts as a copy of the real index, so git knows
 * which files are tracked; `git add -N .` then records every untracked path
 * as intent-to-add without hashing a byte or writing an object; and `git diff
 * --diff-filter=A` over that index shows each one as a new file with its
 * whole content — byte for byte what `--no-index` against `/dev/null`
 * printed, including the binary and "no newline" cases, and in the same
 * order, since the index sorts by path as `ls-files` does. The live index is
 * never opened, so nothing the user has staged is touched and no `index.lock`
 * is taken.
 *
 * Letting git find the files, rather than handing it the listing the route
 * already has, is what makes this safe to run during a build. The listing is
 * out of date the moment it is taken — the reason the diff is being asked for
 * is that files are being written — and `git add` aborts outright on a path
 * that is no longer there. Walking the tree itself, it skips what has gone
 * before it looks, and a file gone between the add and the diff is a
 * deletion, which the filter drops. One window stays: a file that goes
 * between git's directory walk and its stat of that file is a `fatal:
 * unable to stat`, which `--ignore-errors` does not cover. That is a few
 * milliseconds per request, so it is answered by trying the add again on a
 * fresh copy, a few times with a growing pause between, before giving up on
 * the one-shot at all. What else the filter and the flags take care of: a
 * tracked
 * file's own edits and deletions, which are the unstaged diff's business
 * (`--ignore-removal` keeps them in the scratch to be filtered rather than
 * staging them there); and an empty untracked file, which rename detection
 * would otherwise pair with a deleted empty tracked one (`--no-renames`).
 * `core.splitIndex=false` because with the split index on, every write to a
 * fresh index file leaves a `sharedindex.<sha>` in `.git` that only the
 * scratch index references, and git only expires those after a fortnight;
 * refetched once a second through a build, that is thousands of them.
 *
 * Two cases need a hand. A nested repository is listed by `ls-files -o` as
 * `dir/`, and `git add .` either refuses it (no commit checked out; an error
 * `--ignore-errors` steps over, hence exit 1 is accepted) or records it as a
 * gitlink, mode 160000, which no other entry here can be — the per-file diff
 * produced nothing for either, so gitlink sections are dropped. And a path
 * with unmerged entries — a merge the agent is in the middle of — is one
 * `git add .` settles as intent-to-add whatever pathspec is given, which
 * would make a conflicted tracked file appear as a new one; those are settled
 * to an ordinary stage-0 entry in the scratch first, so the add leaves them
 * alone and the filter classifies them as modified.
 *
 * What is left to the per-file diff, through a small pool rather than all at
 * once, is a file git cannot read — permissions, usually — which stops
 * `git diff` partway through with what it had printed so far. That is not an
 * answer, and the per-file diff tolerates it. */
export async function diffUntrackedFiles(dir: string): Promise<string> {
  const diff = await intentToAddDiff(dir);
  if (diff !== null) return diff;
  const paths = (await listGitFiles(dir, { cached: false })).filter((file) => !file.endsWith("/"));
  const diffs = await mapWithConcurrency(paths, UNTRACKED_DIFF_CONCURRENCY, (file) =>
    diffUntrackedFile(dir, file),
  );
  return diffs.join("");
}

const NO_SPLIT_INDEX = ["-c", "core.splitIndex=false"];
/** How many times the intent-to-add is tried before the per-file path, and
 * how long the wait grows between tries: a burst of deletions — a clean
 * rebuild — lasts a few hundred milliseconds, and an attempt made straight
 * away just loses the same race again. */
export const INTENT_TO_ADD_ATTEMPTS = 5;
export const INTENT_TO_ADD_BACKOFF_MS = 100;

/** The one-shot described above, or null when git would not go through with
 * it and the caller has to try something else. */
async function intentToAddDiff(dir: string): Promise<string | null> {
  // `--git-path` rather than `<dir>/.git/index`, because a linked worktree
  // keeps its index under the main repository's `.git/worktrees/<name>/`.
  const [where, unmerged] = await Promise.all([
    gitSpawn(dir, ["rev-parse", "--git-path", "index"]),
    gitSpawn(dir, ["ls-files", "-z", "--unmerged"]),
  ]);
  if (where.exitCode !== 0 || unmerged.exitCode !== 0) return null;
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "codetoaster-diff-"));
  try {
    const index = path.join(scratch, "index");
    const env = { GIT_INDEX_FILE: index };
    const settled = settledStages(unmerged.stdout);
    for (let attempt = 1; ; attempt++) {
      // A fresh copy each time: an add that died wrote nothing, but there is
      // no reason to reason about what it left.
      await fsp.rm(index, { force: true });
      try {
        await fsp.copyFile(path.resolve(dir, where.stdout.trim()), index);
      } catch (error) {
        // A repository with no commit and nothing staged has no index file
        // yet, and an empty scratch is exactly what a copy of it would be.
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null;
      }
      if (settled !== "") {
        const { exitCode } = await gitSpawn(
          dir,
          [...NO_SPLIT_INDEX, "update-index", "-z", "--index-info"],
          { env, stdin: settled },
        );
        if (exitCode !== 0) return null;
      }
      const added = await gitSpawn(
        dir,
        [...NO_SPLIT_INDEX, "add", "--intent-to-add", "--ignore-removal", "--ignore-errors", "--", "."],
        { env },
      );
      // 1 is `--ignore-errors` having stepped over something; anything higher
      // is git having given up.
      if (added.exitCode <= 1) break;
      if (attempt === INTENT_TO_ADD_ATTEMPTS) return null;
      await Bun.sleep(attempt * INTENT_TO_ADD_BACKOFF_MS);
    }
    const { stdout, exitCode } = await gitSpawn(
      dir,
      [...NO_SPLIT_INDEX, "diff", "--no-renames", "--diff-filter=A"],
      { env },
    );
    return exitCode === 0 ? withoutGitlinks(stdout) : null;
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

/** `update-index --index-info` input that settles every unmerged path to one
 * stage-0 entry, from `ls-files -z --unmerged` output — `<mode> <sha> <stage>\t
 * <path>` records, one per stage — or the empty string when there is nothing
 * unmerged. Which stage's blob is used does not matter: the entry exists so
 * that `git add .` sees a tracked file and the diff filter sees a
 * modification, and neither reads the blob. Exported for its test. */
export function settledStages(unmergedList: string): string {
  const seen = new Set<string>();
  let out = "";
  for (const record of unmergedList.split("\0")) {
    if (record === "") continue;
    const tab = record.indexOf("\t");
    const [mode, sha] = record.slice(0, tab).split(" ");
    const file = record.slice(tab + 1);
    if (!mode || !sha || seen.has(file)) continue;
    seen.add(file);
    out += `${mode} ${sha} 0\t${file}\0`;
  }
  return out;
}

/** Drop the sections of a scratch-index diff that describe a gitlink — a
 * nested repository `git add .` recorded — leaving only real files. Exported
 * for its test; see `diffUntrackedFiles`.
 *
 * Splitting on the header is safe because every line of content inside a
 * section carries a prefix — `+`, `-`, a space, `\` — so a file that is itself
 * a patch cannot start a section from inside one. */
export function withoutGitlinks(diff: string): string {
  if (!diff.includes("\nnew file mode 160000\n")) return diff;
  return diff
    .split(/^(?=diff --git )/m)
    .filter((section) => !/^diff --git [^\n]*\nnew file mode 160000\n/.test(section))
    .join("");
}
interface Coalesced {
  running: Promise<unknown>;
  /** The rerun promised to callers who arrived while `running` was under way. */
  queued: Promise<unknown> | null;
}

const inFlight = new Map<string, Coalesced>();

function startCoalesced<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const slot: Coalesced = { running: Promise.resolve(), queued: null };
  slot.running = fn().finally(() => {
    if (inFlight.get(key) === slot) inFlight.delete(key);
  });
  inFlight.set(key, slot);
  return slot.running as Promise<T>;
}

/** Run `fn`, sharing the work with everyone else who asks under the same key
 * while it is under way.
 *
 * Callers who arrive mid-run do not get the run's answer. A refetch of the
 * working-tree diff is made *because* the checkout changed, and a computation
 * that listed the files before that write cannot include it; hand the late
 * caller those bytes and nothing refetches afterwards, so the last file of a
 * burst never appears. Instead every late caller is promised one further run,
 * started as the current one settles — one, however many arrive, which is all
 * the sharing a burst needs. A caller who arrives during that rerun queues the
 * next, and so on: a steady stream of invalidations runs the computation back
 * to back rather than in parallel, and every answer is at least as fresh as
 * the request that asked for it.
 *
 * Entries are cleared as they settle: this is coalescing, not caching. */
export function coalesce<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const slot = inFlight.get(key);
  if (!slot) return startCoalesced(key, fn);
  if (!slot.queued) {
    // Attached after the `finally` that clears the slot, so by the time this
    // runs the map is usually empty for the key and the rerun registers as a
    // new slot. Usually: the clear and this callback are two microtasks, and a
    // handler resuming from its own `await` between them finds no slot and
    // starts a run of its own. Going back through `coalesce` rather than
    // straight to `startCoalesced` queues behind that run instead of running
    // alongside it — its answer is as fresh as the rerun's would have been.
    const rerun = () => coalesce(key, fn);
    slot.queued = slot.running.then(rerun, rerun);
  }
  return slot.queued as Promise<T>;
}

// Both sides are resolved, and the base is resolved for a reason that bites:
// the comparison is a string prefix, so a `dir` carrying a trailing slash —
// `projects.initial_path` is stored as the user typed it, and reaches here as a
// task's cwd — never matches `dir + "/"` and every path under it is refused.
// The containment check is unchanged; it just no longer depends on how the
// caller spelled the directory.
export function safePath(dir: string, filePath: string): string | null {
  const base = path.resolve(dir);
  const resolved = path.resolve(base, filePath);
  if (!resolved.startsWith(base + path.sep)) return null;
  return resolved;
}

// ---------------------------------------------------------------------------
// Tree listing (pure — exported for unit tests)
// ---------------------------------------------------------------------------

export interface FileInfo {
  path: string;
  name: string;
  isDirectory: boolean;
  depth: number;
  /** The repository ignores this entry (TASK-130). On a directory it means the
   * listing stops here: what is inside is asked for separately. */
  ignored?: true;
}

/**
 * Derive a flat file listing (same shape as GET /api/tasks/:id/files) from a
 * set of blob paths. Each parent directory is synthesized once, before the first
 * file living under it; depth is the path's segment count minus one. `size` is
 * omitted — git blobs aren't stat'd.
 *
 * `ignored` is `listIgnoredEntries`' answer, and its entries follow the listed
 * files, flagged. They share the synthesized parents, which are never flagged
 * themselves: a directory is ignored when git names it, not because of what it
 * holds.
 */
export function buildFileListing(paths: string[], ignored: string[] = []): FileInfo[] {
  const dirSet = new Set<string>();
  const files: FileInfo[] = [];
  const addParents = (parts: string[]) => {
    for (let i = 1; i < parts.length; i++) {
      const dirPath = parts.slice(0, i).join("/");
      if (!dirSet.has(dirPath)) {
        dirSet.add(dirPath);
        files.push({ path: dirPath, name: parts[i - 1]!, isDirectory: true, depth: i - 1 });
      }
    }
  };
  for (const relativePath of paths) {
    const parts = relativePath.split("/");
    addParents(parts);
    files.push({
      path: relativePath,
      name: parts[parts.length - 1]!,
      isDirectory: false,
      depth: parts.length - 1,
    });
  }
  for (const entry of ignored) {
    const isDirectory = entry.endsWith("/");
    const relativePath = isDirectory ? entry.slice(0, -1) : entry;
    if (dirSet.has(relativePath)) continue;
    const parts = relativePath.split("/");
    addParents(parts);
    if (isDirectory) dirSet.add(relativePath);
    files.push({
      path: relativePath,
      name: parts[parts.length - 1]!,
      isDirectory,
      depth: parts.length - 1,
      ignored: true,
    });
  }
  return files;
}