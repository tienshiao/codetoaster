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
 * Import-free on purpose: hooks, stores and components all name a root, and
 * none of them should pull the others in to do it.
 */
export type RepoRoot = { kind: "task"; id: string } | { kind: "project"; id: string };

export const taskRoot = (id: string): RepoRoot => ({ kind: "task", id });
export const projectRoot = (id: string): RepoRoot => ({ kind: "project", id });

const PROJECT_PREFIX = "project:";

/** URL prefix: `/api/tasks/<id>` or `/api/projects/<id>`. */
export function rootApi(root: RepoRoot): string {
  const base = root.kind === "task" ? "/api/tasks" : "/api/projects";
  return `${base}/${encodeURIComponent(root.id)}`;
}

/** Where a working-tree image loads from: an image file's tab, and a
 * markdown preview's repository images (TASK-125). */
export function rootImageUrl(root: RepoRoot, path: string): string {
  return `${rootApi(root)}/image?file=${encodeURIComponent(path)}`;
}

/**
 * The root's identity in caches and stores: the bare task id for a task — so
 * every existing query key, view-state slot and localStorage entry keeps its
 * address — and `project:<id>` for a project. A task id is a UUID, so the two
 * never collide.
 */
export function rootId(root: RepoRoot): string {
  return root.kind === "task" ? root.id : `${PROJECT_PREFIX}${root.id}`;
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
 */
export function refetchOnFocusFor(root: RepoRoot | null): boolean {
  return root?.kind === "project";
}
