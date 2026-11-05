import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { taskKeys } from "../query-keys";
import { baseRoot, rootApi, rootId, worktreeRoot, type RepoRoot } from "../repo-root";
import { getViewState, setViewField, subscribeViewField, viewRef } from "../view-state-store";

/** One worktree of a root's repository, as `GET <root>/worktrees` lists it
 * (TASK-138.2). */
export interface WorktreeInfo {
  /** Absolute realpath: what a worktree root and a tab descriptor carry. */
  path: string;
  /** Short branch name, or null when HEAD is detached. */
  branch: string | null;
  head: string;
  /** The root's own checkout — the task's, or the project's directory. */
  current: boolean;
}

export interface WorktreesResponse {
  worktrees: WorktreeInfo[];
}

async function fetchWorktrees(root: RepoRoot): Promise<WorktreesResponse> {
  const res = await fetch(`${rootApi(root)}/worktrees`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to list worktrees");
  }
  return res.json();
}

/**
 * How often the list is re-read while something shows it. Nothing watches a
 * repository's worktree list — a subagent adds and removes its own — so the
 * poll and the focus refetch are the only ways a new one appears or a removed
 * one drops out. One `git worktree list` per interval, cached on the server,
 * and React Query stops it in a background tab.
 */
export const WORKTREES_POLL_MS = 15_000;

/** The worktrees of `root`'s repository, always asked of its base root: a
 * worktree's list is the same list. */
export function useRootWorktrees(root: RepoRoot | null, { refetchOnMount = true } = {}) {
  const base = root ? baseRoot(root) : null;
  const id = base ? rootId(base) : null;
  return useQuery({
    queryKey: taskKeys.worktrees(id),
    queryFn: () => fetchWorktrees(base!),
    enabled: base != null,
    staleTime: 5_000,
    refetchInterval: WORKTREES_POLL_MS,
    refetchOnWindowFocus: true,
    refetchOnMount: refetchOnMount ? "always" : true,
  });
}

/** What the picker says for a worktree: its branch, or a short SHA when it is
 * detached, and the directory it is in. */
export function worktreeLabel(worktree: Pick<WorktreeInfo, "path" | "branch" | "head">): string {
  return `${worktreeName(worktree)} · ${dirName(worktree.path)}`;
}

/** A worktree's branch, or its short SHA when detached. */
export function worktreeName(worktree: Pick<WorktreeInfo, "branch" | "head">): string {
  return worktree.branch ?? (worktree.head.slice(0, 7) || "detached");
}

export function dirName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || trimmed;
}

export interface ExplorerWorktree {
  /** The picker's options: every worktree, when there is more than one, and
   * none otherwise — a repository with one checkout has nothing to pick. */
  worktrees: WorktreeInfo[];
  /** The worktree the Explorer is browsing instead of the root's own
   * checkout, or null for the root's own. */
  chosen: string | null;
  /** What the sections read: the chosen worktree's root, or `root`. */
  browseRoot: RepoRoot | null;
  /** Choose a worktree by path; the root's own checkout (or null) goes back
   * to it. */
  choose: (path: string | null) => void;
}

/**
 * The Explorer's choice of worktree for `root` (TASK-138.2), persisted in the
 * root's `explorer` slot so it survives a remount and a reload.
 *
 * Read from the store rather than through `useViewState` because the shell
 * asks this with no root at all, and there is no slot to bind to then.
 *
 * A stored choice is honoured while the list is still on its way, so a reload
 * onto a worktree does not first draw the task's checkout. Once the list has
 * answered, a choice it no longer holds — the worktree was removed — falls
 * back to the root's own checkout and is cleared; a list that failed to load
 * falls back without clearing, since it proved nothing.
 */
export function useExplorerWorktree(root: RepoRoot | null): ExplorerWorktree {
  const base = root ? baseRoot(root) : null;
  const baseId = base ? rootId(base) : null;
  const { data, isError } = useRootWorktrees(base, { refetchOnMount: false });

  const subscribe = useCallback(
    (listener: () => void) =>
      baseId ? subscribeViewField(viewRef(baseId, "explorer"), "worktree", listener) : () => {},
    [baseId],
  );
  const stored = useSyncExternalStore(subscribe, () =>
    baseId ? getViewState("explorer", viewRef(baseId, "explorer")).worktree : null,
  );

  const all = data?.worktrees;
  const entry = stored && all ? all.find((w) => w.path === stored) : undefined;
  // Undecided (no answer yet) keeps the stored choice; a failed list or one
  // without it, or the root's own checkout, is no choice.
  const chosen = !stored
    ? null
    : all !== undefined
      ? entry && !entry.current
        ? stored
        : null
      : isError
        ? null
        : stored;
  const stale = stored != null && all !== undefined && (!entry || entry.current);

  useEffect(() => {
    if (stale && baseId) setViewField("explorer", viewRef(baseId, "explorer"), "worktree", null);
  }, [stale, baseId]);

  const choose = useCallback(
    (path: string | null) => {
      if (!baseId) return;
      const own = path != null && all?.find((w) => w.path === path)?.current;
      setViewField("explorer", viewRef(baseId, "explorer"), "worktree", own ? null : path);
    },
    [baseId, all],
  );

  const browseRoot = useMemo(
    () => (base && chosen ? worktreeRoot(base, chosen) : root),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `base` by its id
    [root, baseId, chosen],
  );

  const worktrees = useMemo(() => (all && all.length > 1 ? all : []), [all]);
  return { worktrees, chosen, browseRoot, choose };
}
