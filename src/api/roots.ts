import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import type { Server } from "bun";
import { gitSpawn } from "../lib/git/spawn";
import { taskManager } from "../lib/tasks/manager";
import { expandTilde } from "../lib/tilde";
import { decodeWorktreeToken } from "../lib/worktree-token";
import { cachedPromise, type CachedPromise } from "./utils";

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

/** How long one project's `rev-parse --show-toplevel` stands in for the next. */
const PROJECT_TOPLEVEL_TTL_MS = 3000;
const projectToplevelCache = new Map<string, CachedPromise<string>>();

/**
 * The repository toplevel of `dir`, cached (`cachedPromise`): the Explorer
 * opens a project with five or six routes at once, each needing this answer.
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

/** The scopes a root is named by directly: a task, or a project. */
export type BaseRootScope = "tasks" | "projects";

/** Which kind of id a repository-reading route was addressed by. `worktrees`
 * is one of the others' repository's worktrees, named by a token that carries
 * the base root as well as the path (TASK-138.2). */
export type RootScope = BaseRootScope | "worktrees";

export function resolveRoot(scope: RootScope, id: string): Promise<TaskRoot | { error: Response }> {
  if (scope === "worktrees") return resolveWorktreeRoot(id);
  return scope === "tasks" ? resolveTaskRoot(id) : resolveProjectRoot(id);
}

// ── worktrees (TASK-138.2) ──────────────────────────────────────────────────

/** One record of `git worktree list --porcelain`. */
export interface WorktreeRecord {
  path: string;
  /** The checked-out commit; empty for a bare entry, which has none. */
  head: string;
  /** The short branch name, or null for a detached HEAD (and a bare entry). */
  branch: string | null;
  bare: boolean;
  /** git's own verdict that the worktree's directory is gone. */
  prunable: boolean;
}

/**
 * `git worktree list --porcelain`, as records.
 *
 * Line-based rather than `-z`: `-z` is git 2.36's, and a path git had to quote
 * (one with a newline in it) arrives quoted and simply fails to match a
 * realpath later, so such a worktree cannot be browsed rather than browsing
 * the wrong thing.
 */
export function parseWorktreeList(porcelain: string): WorktreeRecord[] {
  const records: WorktreeRecord[] = [];
  let current: WorktreeRecord | null = null;
  for (const line of porcelain.split("\n")) {
    // `worktree` always opens a record; the blank line that closes one needs
    // no handling of its own.
    if (line.startsWith("worktree ")) {
      if (current) records.push(current);
      current = { path: line.slice("worktree ".length), head: "", branch: null, bare: false, prunable: false };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("HEAD ")) current.head = line.slice("HEAD ".length);
    else if (line.startsWith("branch ")) current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    else if (line === "bare") current.bare = true;
    else if (line === "prunable" || line.startsWith("prunable ")) current.prunable = true;
  }
  if (current) records.push(current);
  return records;
}

/** How long one repository's worktree listing stands in for the next: the
 * Explorer opens a worktree with five or six routes at once, each resolving
 * the token through this. */
const WORKTREE_LIST_TTL_MS = 3000;
const worktreeListCache = new Map<string, CachedPromise<WorktreeRecord[]>>();

function cachedWorktreeList(repoRoot: string): Promise<WorktreeRecord[]> {
  return cachedPromise(worktreeListCache, repoRoot, WORKTREE_LIST_TTL_MS, () =>
    gitSpawn(repoRoot, ["worktree", "list", "--porcelain"]).then(({ stdout, exitCode }) => {
      if (exitCode !== 0) throw new Error(`Could not list worktrees of ${repoRoot}`);
      return parseWorktreeList(stdout);
    }),
  );
}

async function realpathOrNull(p: string): Promise<string | null> {
  try {
    return await fsp.realpath(p);
  } catch {
    return null;
  }
}

/** A worktree that can be browsed: listed, neither bare nor prunable, and on
 * disk now. `realPath` is what it is compared and served by. */
export interface LiveWorktree extends WorktreeRecord {
  realPath: string;
}

/**
 * The worktrees of the repository at `repoRoot` that are there to browse.
 *
 * The listing is cached for a few seconds, so the directory is checked on
 * every call rather than trusted to the cache: a `git worktree remove` or an
 * `rm -rf` has to stop serving the path at once, not three seconds later.
 * Compared by realpath, because git and the client need not spell a path the
 * same way (`/tmp` and `/private/tmp` on macOS).
 */
export async function liveWorktrees(repoRoot: string): Promise<LiveWorktree[]> {
  const records = await cachedWorktreeList(repoRoot);
  const live = await Promise.all(
    records.map(async (record) => {
      if (record.bare || record.prunable) return null;
      const realPath = await realpathOrNull(record.path);
      return realPath ? { ...record, realPath } : null;
    }),
  );
  return live.filter((w): w is LiveWorktree => w !== null);
}

const worktreeNotFound = () => ({
  error: Response.json({ error: "Worktree not found" }, { status: 404 }),
});

/**
 * A worktree token as a `TaskRoot`: the base root it names, resolved as its own
 * scope would be (its 404s and 400s pass through), and then the path — served
 * only when it is one of that repository's live worktrees. Anything else is a
 * 404, so a token cannot reach a directory by claiming a repository it is not
 * a worktree of.
 */
export async function resolveWorktreeRoot(token: string): Promise<TaskRoot | { error: Response }> {
  const decoded = decodeWorktreeToken(token);
  if (!decoded) {
    return { error: Response.json({ error: "Invalid worktree token" }, { status: 400 }) };
  }
  const base = await resolveRoot(decoded.scope, decoded.id);
  if ("error" in base) return base;
  const target = await realpathOrNull(decoded.path);
  if (!target) return worktreeNotFound();
  let worktrees: LiveWorktree[];
  try {
    worktrees = await liveWorktrees(base.repoRoot);
  } catch {
    return worktreeNotFound();
  }
  const match = worktrees.find((w) => w.realPath === target);
  if (!match) return worktreeNotFound();
  return { repoRoot: match.realPath, cwd: match.realPath };
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
 * One handler, served under `/api/tasks/:id/<subpath>`,
 * `/api/projects/:id/<subpath>` and `/api/worktrees/:token/<subpath>`.
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
    // Any worktree of either's repository, by token (TASK-138.2). The same
    // handler: a worktree is a checkout like any other once it is resolved.
    [`/api/worktrees/:id/${subpath}`]: scoped("worktrees"),
  };
}
