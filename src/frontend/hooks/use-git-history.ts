import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { useGitLog, type FetchUntilStatus } from "./use-git-log";
import { useGitRefs } from "./use-git-refs";
import { useRefSets } from "../components/git/RefChip";
import { useTasks } from "../TaskContext";
import { queryClient } from "../query-client";
import type { RefSets } from "../components/git/RefChip";
import type { GitLogCommit } from "../types/git";

export interface GitHistory {
  logQuery: ReturnType<typeof useGitLog>;
  refsQuery: ReturnType<typeof useGitRefs>;
  refSets: RefSets;
  /** Every loaded page, flattened — the graph is one list, not a list of pages. */
  commits: GitLogCommit[];
  /** Sha whose fetch-until is in flight after a sidebar click (drives the
   * sidebar spinner and gates further clicks). */
  pendingRefSha: string | null;
  /** Sidebar ref click: hand the caller a sha to select, paging history in
   * first when the ref is deeper than the loaded window. */
  selectRef: (sha: string) => Promise<void>;
  /** Toast for the non-found outcomes of a seek. Exposed because v1's deep-link
   * effect runs its own seek and has to report the same way. */
  reportSeekFailure: (status: Exclude<FetchUntilStatus, "found">) => void;
  /** As above: v1's `?commit=` seek needs the raw primitives. Both go with the
   * git route in TASK-21 — a v2 history tab has no URL selection to reconcile. */
  fetchUntil: (sha: string) => Promise<FetchUntilStatus>;
  setPendingRefSha: Dispatch<SetStateAction<string | null>>;
}

/**
 * The commit graph's data: the log and refs queries, the flattened commit list,
 * and the seek that a ref click needs when its target is below the loaded
 * window.
 *
 * Shared by v1's git route and v2's `history` tab, which differ only in what
 * "select a commit" means — a navigation there, a new tab here — so the choice
 * arrives as `onSelect` rather than being made in here.
 *
 * `onReset` fires when a refs change invalidates the loaded log. v1 hangs its
 * `attemptedShas` clear off it; v2 has nothing to clear.
 */
export function useGitHistory(
  taskId: string,
  onSelect: (sha: string) => void,
  onReset?: () => void,
): GitHistory {
  const logQuery = useGitLog(taskId);
  const refsQuery = useGitRefs(taskId);
  const refSets = useRefSets(refsQuery.data);
  const { fetchUntil } = logQuery;
  const { activity } = useTasks();

  const [pendingRefSha, setPendingRefSha] = useState<string | null>(null);

  const commits = useMemo(
    () => logQuery.data?.pages.flatMap((p) => p.commits) ?? [],
    [logQuery.data],
  );

  // Toast for the non-found outcomes of a fetch-until seek. "found" is handled
  // by the caller (it decides whether to also select the commit).
  const reportSeekFailure = useCallback((status: Exclude<FetchUntilStatus, "found">) => {
    switch (status) {
      case "too-deep":
        toast("Ref is too deep in history (>50k commits) to load here.");
        break;
      case "stale":
        toast("History changed — reloading");
        break;
      case "error":
        toast("Failed to load history for this ref");
        break;
    }
  }, []);

  // Sidebar ref click: select directly if the head is already loaded, else
  // fetch history through to it before selecting. Refs deeper than the hard cap
  // surface a notice rather than paging in tens of thousands of rows.
  const selectRef = useCallback(
    async (sha: string) => {
      if (commits.some((c) => c.hash === sha)) {
        onSelect(sha);
        return;
      }
      setPendingRefSha(sha);
      try {
        const status = await fetchUntil(sha);
        if (status === "found") {
          onSelect(sha);
        } else {
          reportSeekFailure(status);
        }
      } finally {
        setPendingRefSha(null);
      }
    },
    [commits, fetchUntil, onSelect, reportSeekFailure],
  );

  // Refetch refs when the task's PTY activity settles (true→false). The 300ms
  // debounced activity signal flipping off is a good proxy for "a command just
  // finished" — refs may have moved. Track the previous value so mount and
  // false→true transitions don't refetch.
  //
  // Keyed to the task, because this hook is not remounted per task: the
  // Explorer renders its History and Refs sections at a fixed position with no
  // `key`, so `taskId` changes underneath one instance. Unkeyed, the previous
  // task's `true` followed by the new task's `false` read as a command settling
  // and refetched refs that were never stale.
  const active = activity[taskId] ?? false;
  const prevActiveRef = useRef<{ taskId: string; active: boolean }>({ taskId, active });
  const refsRefetch = refsQuery.refetch;
  useEffect(() => {
    const previous = prevActiveRef.current;
    prevActiveRef.current = { taskId, active };
    if (previous.taskId === taskId && previous.active && !active) refsRefetch();
  }, [taskId, active, refsRefetch]);

  // Held in a ref so a caller passing an inline closure does not re-run — and
  // so re-reset — the effect below on every render.
  const onResetRef = useRef(onReset);
  onResetRef.current = onReset;

  // When the refs payload hash actually changes (not first load, not an
  // identical refetch), the log window may be invalid: reset it to page one and
  // tell the caller, so anything keyed to the old history is dropped with it.
  // Only a change between two DEFINED hashes acts, so undefined→A (initial) and
  // A→A (unchanged refetch) never reset or loop.
  //
  // Keyed to the task for the same reason `prevActiveRef` is: one hook instance
  // outlives the task selection. Two different repositories' hashes are not one
  // repository's refs moving, and with both tasks' refs still in the query cache
  // the switch delivers hashA→hashB in a single run — so clicking back to a
  // task reset the log it had just restored, throwing away several hundred
  // paged-in commits and landing the restored scroll offset nowhere.
  const refsHash = refsQuery.data?.hash;
  const prevRefsHashRef = useRef<{ taskId: string; hash: string | undefined }>({
    taskId,
    hash: refsHash,
  });
  useEffect(() => {
    const previous = prevRefsHashRef.current;
    prevRefsHashRef.current = { taskId, hash: refsHash };
    if (previous.taskId !== taskId) return;
    if (previous.hash !== undefined && refsHash !== undefined && previous.hash !== refsHash) {
      queryClient.resetQueries({ queryKey: ["git-log", taskId] });
      onResetRef.current?.();
    }
  }, [refsHash, taskId]);

  return {
    logQuery,
    refsQuery,
    refSets,
    commits,
    pendingRefSha,
    selectRef,
    reportSeekFailure,
    fetchUntil,
    setPendingRefSha,
  };
}
