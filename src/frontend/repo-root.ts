/**
 * What the Explorer and the read-only panes read from: a repository, named
 * either by a task or by a project (TASK-106).
 *
 * Every file tree, diff, history and backlog view used to take a `taskId`,
 * because until the composer there was always a task behind them. The
 * composer has none yet — the user is still writing the prompt that will make
 * one — but it has a chosen project, and a project with a directory is the
 * same repository a task would check out. The server answers the same routes
 * under `/api/projects/<id>/…` as under `/api/tasks/<id>/…`, so the only
 * things that differ are the URL prefix and the cache identity; this module
 * is where both are decided.
 *
 * A third kind is one of those roots' repository's *other* worktrees
 * (TASK-138.2) — a subagent's checkout, most often. It is named by its base
 * root and its path, and served under `/api/worktrees/<token>/…`, where the
 * token carries both so the server can refuse a path that is not one of the
 * base repository's worktrees.
 *
 * Import-free on purpose: hooks, stores and components all name a root, and
 * none of them should pull the others in to do it. The one import is the
 * token codec, which is import-free itself and shared with the server.
 */
import { encodeWorktreeToken } from "@/lib/worktree-token";

/** A root named directly: a task's checkout or a project's directory. */
export type BaseRoot = { kind: "task"; id: string } | { kind: "project"; id: string };

export type RepoRoot = BaseRoot | { kind: "worktree"; base: BaseRoot; path: string };

export const taskRoot = (id: string): RepoRoot => ({ kind: "task", id });
export const projectRoot = (id: string): RepoRoot => ({ kind: "project", id });
/** Another worktree of `base`'s repository, at the absolute `path`. A
 * worktree root's own base is used when one is passed, so worktrees never
 * nest. */
export const worktreeRoot = (base: RepoRoot, path: string): RepoRoot => ({
  kind: "worktree",
  base: baseRoot(base),
  path,
});

/** The task or project a root belongs to: itself, or a worktree's base. */
export function baseRoot(root: RepoRoot): BaseRoot {
  return root.kind === "worktree" ? root.base : root;
}

const PROJECT_PREFIX = "project:";
const WORKTREE_PREFIX = "worktree:";

/** URL prefix: `/api/tasks/<id>`, `/api/projects/<id>` or
 * `/api/worktrees/<token>`. */
export function rootApi(root: RepoRoot): string {
  if (root.kind === "worktree") {
    const token = encodeWorktreeToken({
      scope: root.base.kind === "task" ? "tasks" : "projects",
      id: root.base.id,
      path: root.path,
    });
    return `/api/worktrees/${token}`;
  }
  const base = root.kind === "task" ? "/api/tasks" : "/api/projects";
  return `${base}/${encodeURIComponent(root.id)}`;
}

/** Where a working-tree image loads from: an image file's tab, and a
 * markdown preview's repository images (TASK-125). */
export function rootImageUrl(root: RepoRoot, path: string): string {
  return `${rootApi(root)}/image?file=${encodeURIComponent(path)}`;
}

/** The same image as it was at `ref`: what a file read at a commit loads
 * instead (TASK-127). */
export function rootGitImageUrl(root: RepoRoot, ref: string, path: string): string {
  return `${rootApi(root)}/image/git?ref=${encodeURIComponent(ref)}&file=${encodeURIComponent(path)}`;
}

/**
 * The root's identity in caches and stores: the bare task id for a task — so
 * every existing query key, view-state slot and localStorage entry keeps its
 * address — and `project:<id>` for a project. A task id is a UUID, so the two
 * never collide.
 *
 * A worktree root is `worktree:<base>:<path>`, with the base's own id
 * URI-encoded so it holds no colon and `baseRootId` can find where it ends —
 * the path is absolute and may hold anything.
 */
export function rootId(root: RepoRoot): string {
  if (root.kind === "worktree") {
    return `${WORKTREE_PREFIX}${encodeURIComponent(rootId(root.base))}:${root.path}`;
  }
  return root.kind === "task" ? root.id : `${PROJECT_PREFIX}${root.id}`;
}

/** The root id of the task or project a root id belongs to: the id itself,
 * or a worktree root's base. What a sweep keyed by task and project ids keeps
 * a worktree's entries by. */
export function baseRootId(id: string): string {
  if (!id.startsWith(WORKTREE_PREFIX)) return id;
  const rest = id.slice(WORKTREE_PREFIX.length);
  const colon = rest.indexOf(":");
  if (colon === -1) return id;
  try {
    return decodeURIComponent(rest.slice(0, colon));
  } catch {
    return id;
  }
}

/** Whether a root's checkout is watched, so the server says when it changed
 * (TASK-103) and a change can be flashed (TASK-136). A worktree root is the
 * one that never is: nothing on the server watches a subagent's checkout. */
export function isWatchedRoot(root: RepoRoot): boolean {
  return root.kind !== "worktree";
}

/**
 * Whether a root's queries refetch when the window regains focus.
 *
 * A task's checkout is watched: the server sends a `changed` frame and the
 * change-invalidation stales exactly what moved. A project's own directory is
 * reached that way only while a task without a worktree runs in it; with none,
 * nothing watches it at all, and the composer's Explorer would go on showing
 * whatever the tree looked like when it first loaded. Coming back to the
 * window is the likeliest moment the user has edited it elsewhere, so a
 * project root refetches then (still subject to the client's `staleTime`).
 *
 * A worktree root (TASK-138.2) is watched by nothing at all, so it does the
 * same.
 */
export function refetchOnFocusFor(root: RepoRoot | null): boolean {
  return root?.kind === "project" || root?.kind === "worktree";
}
