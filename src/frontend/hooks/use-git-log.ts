import { useCallback, useEffect } from "react";
import { useInfiniteQuery, type InfiniteData } from "@tanstack/react-query";
import { queryClient } from "../query-client";
import type { GitLogPage } from "../types/git";

/**
 * A 409 from the log endpoint: the client's window no longer matches server
 * history. Thrown from the queryFn so the stale-reset happens once, in an
 * effect, rather than as a side effect racing react-query's retry.
 */
export class StaleLogError extends Error {
  constructor() {
    super("History changed — reloading");
    this.name = "StaleLogError";
  }
}

/**
 * Outcome of a fetch-until-sha seek:
 * - "found":    the target is now in the loaded window (already there, or paged in).
 * - "too-deep": server reached its hard cap without the target (genuine depth miss).
 * - "stale":    a 409 — history drifted; the log is being reset/refetched.
 * - "error":    non-ok HTTP, missing cache, a network exception, or retry exhaustion.
 */
export type FetchUntilStatus = "found" | "too-deep" | "stale" | "error";

// Page cursor: how many rows are already loaded (`skip`) plus, past the first
// page, the last-loaded commit hash used for server-side drift detection.
interface LogPageParam {
  skip: number;
  after?: string;
}

const PAGE_LIMIT = 200;

function logQueryKey(taskId: string) {
  return ["git-log", taskId] as const;
}

/**
 * A 409 means the client's window no longer matches server history (new commits
 * arrived / refs moved). Reset the infinite query so it refetches page one.
 */
function handleStale(taskId: string) {
  queryClient.resetQueries({ queryKey: logQueryKey(taskId) });
}

async function fetchGitLog(taskId: string, param: LogPageParam): Promise<GitLogPage> {
  const params = new URLSearchParams({ skip: String(param.skip), limit: String(PAGE_LIMIT) });
  if (param.skip > 0 && param.after) params.set("after", param.after);

  const res = await fetch(`/api/tasks/${taskId}/git/log?${params}`);
  // Throw a typed error WITHOUT resetting here — the reset is performed once,
  // outside the fetch/retry cycle, by an effect watching query.error.
  if (res.status === 409) {
    throw new StaleLogError();
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to fetch git log");
  }
  return res.json();
}

/** `enabled` is for a caller that has no task yet — the command palette at
 * `/` — where an empty id would otherwise be fetched as `/api/tasks//git/log`. */
export function useGitLog(taskId: string, enabled = true) {
  const query = useInfiniteQuery({
    queryKey: logQueryKey(taskId),
    queryFn: ({ pageParam }) => fetchGitLog(taskId, pageParam),
    initialPageParam: { skip: 0 } as LogPageParam,
    enabled,
    // A stale window won't fix itself by retrying the same request — reset it
    // instead (below). Every other error keeps the global retry:1 semantics.
    retry: (failureCount, error) => !(error instanceof StaleLogError) && failureCount < 1,
    getNextPageParam: (lastPage, allPages): LogPageParam | undefined => {
      if (!lastPage.hasMore) return undefined;
      const skip = allPages.reduce((sum, page) => sum + page.commits.length, 0);
      const lastCommits = allPages[allPages.length - 1]!.commits;
      const after = lastCommits[lastCommits.length - 1]?.hash;
      return { skip, after };
    },
  });

  // Perform the stale reset exactly once, outside the fetch/retry cycle. The
  // reset clears query.error and refetches page one, so this fires once per
  // StaleLogError instance rather than looping.
  const staleError = query.error instanceof StaleLogError;
  useEffect(() => {
    if (staleError) handleStale(taskId);
  }, [staleError, taskId]);

  /**
   * Fetch history through a specific sha (a sidebar ref click that lands deeper
   * than the loaded window). Requests `until=sha` from the current loaded count,
   * appends the returned rows as one contiguous page into the infinite cache so
   * lane assignment stays deterministic, and reports whether the sha was found.
   */
  const fetchUntil = useCallback(
    async (sha: string): Promise<FetchUntilStatus> => {
      // The cursor snapshot below and the append at the end must agree on the
      // loaded row count, or a concurrent fetchNextPage would make both append
      // pages computed from the same skip (duplicate rows → corrupted lanes).
      // So: wait out in-flight page fetches, verify the count inside the
      // updater, and retry from a fresh snapshot if it moved underneath us.
      for (let attempt = 0; attempt < 3; attempt++) {
        for (
          let waited = 0;
          waited < 50 &&
          queryClient.getQueryState(logQueryKey(taskId))?.fetchStatus === "fetching";
          waited++
        ) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        const data = queryClient.getQueryData<InfiniteData<GitLogPage, LogPageParam>>(
          logQueryKey(taskId),
        );
        if (!data) return "error";

        const allCommits = data.pages.flatMap((p) => p.commits);
        if (allCommits.some((c) => c.hash === sha)) return "found";
        const skip = allCommits.length;
        const after = skip > 0 ? allCommits[allCommits.length - 1]!.hash : undefined;

        const params = new URLSearchParams({ skip: String(skip), until: sha });
        if (after) params.set("after", after);

        // Wrap the raw fetch so a network exception becomes "error" rather than
        // escaping to the caller's await (this is not a queryFn — react-query
        // won't catch it).
        let page: GitLogPage;
        try {
          const res = await fetch(`/api/tasks/${taskId}/git/log?${params}`);
          if (res.status === 409) {
            // Direct 409 handling (not inside a queryFn): reset now and report.
            handleStale(taskId);
            return "stale";
          }
          if (!res.ok) return "error";
          page = await res.json();
        } catch {
          return "error";
        }

        // Genuine depth miss: the server reached its hard cap without the sha.
        if (!page.found) return "too-deep";

        // Append the fetched rows as a new page with a matching cursor so
        // getNextPageParam continues seamlessly from the until commit — but
        // only if the loaded count is still the skip we requested from.
        let applied = false;
        queryClient.setQueryData<InfiniteData<GitLogPage, LogPageParam>>(
          logQueryKey(taskId),
          (old) => {
            if (!old) return old;
            const loaded = old.pages.reduce((sum, p) => sum + p.commits.length, 0);
            if (loaded !== skip) return old;
            applied = true;
            return {
              pages: [...old.pages, { commits: page.commits, hasMore: page.hasMore }],
              pageParams: [...old.pageParams, { skip, after }],
            };
          },
        );
        if (applied) return "found";
        // A concurrent page landed between snapshot and append — retry.
      }
      // Retry exhaustion: a concurrent page kept landing between snapshot and
      // append. Report as a generic error rather than a false depth miss.
      return "error";
    },
    [taskId],
  );

  return { ...query, fetchUntil };
}
