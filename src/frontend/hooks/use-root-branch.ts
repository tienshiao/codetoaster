import type { RepoRoot } from "@/frontend/repo-root";
import type { GitRefsResponse } from "@/frontend/types/git";
import { useGitRefs } from "./use-git-refs";

/**
 * How often the composer re-reads the project's refs (TASK-137).
 *
 * The composer's root is the project's own directory, and nothing watches that
 * unless a task without a worktree happens to be running in it: then its
 * `changed` frames stale these refs like any other. Otherwise the refs refetch
 * on window focus, which covers switching branch in another app and coming
 * back. What neither covers is a terminal beside the browser, where the
 * window never loses focus to be regained. A poll this slow costs one
 * `for-each-ref` per interval, and React Query stops it in a background tab.
 */
export const COMPOSER_REFS_POLL_MS = 10_000;

/** The poll, except for a root that has never answered: a directory that is
 * not a repository answers 400 every time, so asking again each interval (twice,
 * with the client's retry) buys nothing. Focus refetch still catches one that
 * becomes a repository; a root that has answered once keeps polling. */
export function composerRefsPoll(query: { state: { status: string; data: unknown } }): number | false {
  return query.state.status === "error" && query.state.data === undefined
    ? false
    : COMPOSER_REFS_POLL_MS;
}

/** What a status bar says HEAD is on: the branch, or a short SHA when HEAD is
 * detached. Null when there is nothing to say: no refs yet, or a repository
 * with no commits and no branch either. */
export function branchLabel(head: GitRefsResponse["head"] | undefined): string | null {
  if (!head) return null;
  if (head.ref) return head.ref;
  return head.sha ? head.sha.slice(0, 7) : null;
}

/**
 * The branch `root`'s checkout is on, for the composer's status bar
 * (TASK-137). That is what a task without a worktree runs on, and what a
 * worktree task branches off unless a base ref is named — so it is the
 * checkout's branch, not a promise about the task's.
 *
 * The same refs query the Explorer's Refs and History sections read, so with
 * the panel open this costs nothing extra. A directory that is not a
 * repository answers 400, which is an error here and so no label: there is no
 * branch to show, and "not a git repository" is the Explorer's to say.
 */
export function useRootBranch(root: RepoRoot | null): string | null {
  const { data, error } = useGitRefs(root, true, { refetchInterval: composerRefsPoll });
  // Errored with stale data in hand (the repository was removed under us):
  // what we last read is no longer where HEAD is.
  if (error) return null;
  return branchLabel(data?.head);
}
