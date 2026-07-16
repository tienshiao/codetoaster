import { useMemo, useEffect, useCallback, useRef, useState } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useGitLog, type FetchUntilStatus } from "../../hooks/use-git-log";
import { useGitRefs } from "../../hooks/use-git-refs";
import { setGitViewCommit } from "../../view-state-store";
import { Button } from "../ui/button";
import { CommitList } from "./CommitList";
import { CommitDetail } from "./CommitDetail";
import { RefSidebar } from "./RefSidebar";
import type { GitViewMode } from "../../types/git";

interface GitViewProps {
  sessionId: string;
}

// A loaded commit matches the (possibly short) URL sha when either equals the
// other's prefix — the URL may carry an abbreviated sha while log rows are full
// 40-char hashes. Kept local rather than imported from CommitList (do-not-touch).
function shaMatches(rowSha: string, target: string): boolean {
  return rowSha === target || rowSha.startsWith(target) || target.startsWith(rowSha);
}

export function GitView({ sessionId }: GitViewProps) {
  const navigate = useNavigate();
  const { slug } = useParams({ strict: false }) as { slug: string };
  const search = useSearch({ strict: false }) as { commit?: string; mode?: GitViewMode; file?: string };

  const logQuery = useGitLog(sessionId);
  const refsQuery = useGitRefs(sessionId);
  const { fetchUntil } = logQuery;

  // Sha whose fetch-until is in flight after a sidebar click (drives the
  // sidebar spinner and gates further clicks).
  const [pendingRefSha, setPendingRefSha] = useState<string | null>(null);

  const commits = useMemo(
    () => logQuery.data?.pages.flatMap((p) => p.commits) ?? [],
    [logQuery.data],
  );

  // ?commit= is the source of truth; fall back to HEAD when unset, and to the
  // newest loaded commit (topo-order) when refs are unavailable (e.g. the refs
  // request failed) so a selection is still made.
  const selectedSha = search.commit ?? refsQuery.data?.head.sha ?? commits[0]?.hash;

  // Mirror the explicit URL selection into the store so tab/session switches
  // restore it (session-nav reads gitView.commit).
  useEffect(() => {
    setGitViewCommit(sessionId, search.commit);
  }, [sessionId, search.commit]);

  const selectCommit = useCallback(
    (sha: string) => {
      // The effect above mirrors search.commit into the store, so the explicit
      // store write here would be redundant — navigation is the single source.
      navigate({
        to: "/sessions/$slug/git",
        params: { slug },
        // Keep the current mode; only the commit changes.
        search: { commit: sha, mode: search.mode, file: search.file },
        replace: true,
      });
    },
    [navigate, slug, sessionId, search.mode, search.file],
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
        selectCommit(sha);
        return;
      }
      setPendingRefSha(sha);
      try {
        const status = await fetchUntil(sha);
        if (status === "found") {
          selectCommit(sha);
        } else {
          reportSeekFailure(status);
        }
      } finally {
        setPendingRefSha(null);
      }
    },
    [commits, fetchUntil, selectCommit, reportSeekFailure],
  );

  // Deep link: ?commit= may point past the loaded window (a sidebar click is the
  // only other path that pages there). When the log has loaded, a commit is
  // requested, and nothing loaded matches it, seek the same way selectRef does.
  // The URL already carries the selection, so on "found" we let CommitList's own
  // scroll effect reveal it — no selectCommit here. Attempted shas are remembered
  // so a miss (too-deep/error) never re-seeks and loops.
  const attemptedShas = useRef<Set<string>>(new Set());
  useEffect(() => {
    const target = search.commit;
    if (!target) return;
    if (logQuery.isLoading || logQuery.error) return;
    if (commits.length === 0) return;
    if (pendingRefSha) return; // a seek is already in flight
    if (commits.some((c) => shaMatches(c.hash, target))) return; // already loaded
    if (attemptedShas.current.has(target)) return; // don't re-seek the same sha
    attemptedShas.current.add(target);

    setPendingRefSha(target);
    (async () => {
      try {
        const status = await fetchUntil(target);
        if (status !== "found") reportSeekFailure(status);
      } finally {
        setPendingRefSha(null);
      }
    })();
  }, [
    search.commit,
    commits,
    logQuery.isLoading,
    logQuery.error,
    pendingRefSha,
    fetchUntil,
    reportSeekFailure,
  ]);

  if (logQuery.isLoading || refsQuery.isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm gap-2">
        <Loader2 className="animate-spin" size={16} /> Loading history...
      </div>
    );
  }

  if (logQuery.error) {
    const message = logQuery.error instanceof Error ? logQuery.error.message : String(logQuery.error);
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-sm gap-3">
        <p>{message}</p>
        <Button variant="outline" size="sm" onClick={() => logQuery.refetch()}>
          <RefreshCw size={14} /> Retry
        </Button>
      </div>
    );
  }

  if (commits.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        No commits in this repository.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-row">
      <RefSidebar
        refs={refsQuery.data}
        refsError={!!refsQuery.error}
        onSelectRef={selectRef}
        pendingSha={pendingRefSha}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Refs failed but the log succeeded: surface it without blanking the
            view — branch/tag decorations and the HEAD default are just missing. */}
        {refsQuery.error && (
          <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 text-xs bg-amber-500/10 text-amber-500 border-b border-amber-500/20">
            <span className="flex-1">Could not load branch/tag refs.</span>
            <button
              type="button"
              onClick={() => refsQuery.refetch()}
              className="inline-flex items-center gap-1 hover:text-amber-400"
            >
              <RefreshCw size={12} /> Retry
            </button>
          </div>
        )}

        {/* Top: commit list (fixed 40% split for phase 1) */}
        <div className="h-[40%] min-h-[140px] border-b border-border overflow-hidden">
          <CommitList
            commits={commits}
            selectedSha={selectedSha}
            onSelect={selectCommit}
            hasMore={logQuery.hasNextPage ?? false}
            isFetchingNextPage={logQuery.isFetchingNextPage}
            // Paused while a ref-seek (fetchUntil) is in flight so the two
            // append paths can't compute pages from the same cursor.
            onLoadMore={() => {
              if (!pendingRefSha) logQuery.fetchNextPage();
            }}
            refsData={refsQuery.data}
          />
        </div>

        {/* Bottom: commit detail */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <CommitDetail sessionId={sessionId} sha={selectedSha} onSelectCommit={selectCommit} />
        </div>
      </div>
    </div>
  );
}
