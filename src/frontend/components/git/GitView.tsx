import { useMemo, useEffect, useCallback } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { Loader2, RefreshCw } from "lucide-react";
import { useGitLog } from "../../hooks/use-git-log";
import { useGitRefs } from "../../hooks/use-git-refs";
import { setGitViewCommit } from "../../view-state-store";
import { Button } from "../ui/button";
import { CommitList } from "./CommitList";
import { CommitDetail } from "./CommitDetail";
import type { GitViewMode } from "../../types/git";

interface GitViewProps {
  sessionId: string;
}

export function GitView({ sessionId }: GitViewProps) {
  const navigate = useNavigate();
  const { slug } = useParams({ strict: false }) as { slug: string };
  const search = useSearch({ strict: false }) as { commit?: string; mode?: GitViewMode; file?: string };

  const logQuery = useGitLog(sessionId);
  const refsQuery = useGitRefs(sessionId);

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
    <div className="h-full flex flex-col">
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
          onLoadMore={() => logQuery.fetchNextPage()}
        />
      </div>

      {/* Bottom: commit detail */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <CommitDetail sessionId={sessionId} sha={selectedSha} onSelectCommit={selectCommit} />
      </div>
    </div>
  );
}
