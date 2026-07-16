import { useMemo, useEffect, useCallback, useRef, useState } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useGitLog, type FetchUntilStatus } from "../../hooks/use-git-log";
import { useGitRefs } from "../../hooks/use-git-refs";
import { setGitViewSelection } from "../../view-state-store";
import { useViewState } from "../../hooks/use-view-state";
import { useSession } from "../../SessionContext";
import { queryClient } from "../../query-client";
import { Button } from "../ui/button";
import { CommitList } from "./CommitList";
import { CommitDetail } from "./CommitDetail";
import { RefSidebar } from "./RefSidebar";
import { useRefSets } from "./RefChip";
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

  const { sessionActivity } = useSession();

  const logQuery = useGitLog(sessionId);
  const refsQuery = useGitRefs(sessionId);
  const refSets = useRefSets(refsQuery.data);
  const { fetchUntil } = logQuery;

  // Sha whose fetch-until is in flight after a sidebar click (drives the
  // sidebar spinner and gates further clicks).
  const [pendingRefSha, setPendingRefSha] = useState<string | null>(null);

  // Draggable top/bottom split. Backed by the per-session view-state store
  // (GitView remounts per session via route key, so the hook's mount-time seed
  // restores the persisted ratio), written back once per drag on pointerup.
  const [splitRatio, setSplitRatio] = useViewState(sessionId, "gitView", "splitRatio");
  const [dragging, setDragging] = useState(false);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  // The top pane whose height the divider drives. During a drag the height is
  // written imperatively on this element (see onDividerPointerMove).
  const topPaneRef = useRef<HTMLDivElement>(null);
  // Last ratio produced by the in-flight drag; committed to state on pointerup.
  const dragRatioRef = useRef<number | null>(null);

  const commits = useMemo(
    () => logQuery.data?.pages.flatMap((p) => p.commits) ?? [],
    [logQuery.data],
  );

  // ?commit= is the source of truth; fall back to HEAD when unset, and to the
  // newest loaded commit (topo-order) when refs are unavailable (e.g. the refs
  // request failed) so a selection is still made.
  const selectedSha = search.commit ?? refsQuery.data?.head.sha ?? commits[0]?.hash;

  // The bottom-pane mode persists independently of selection; default to commit.
  const mode: GitViewMode = search.mode ?? "commit";

  // Mirror the explicit URL selection into the store so tab/session switches
  // restore it (session-nav reads gitView.commit/mode/file).
  useEffect(() => {
    setGitViewSelection(sessionId, { commit: search.commit, mode: search.mode, file: search.file });
  }, [sessionId, search.commit, search.mode, search.file]);

  // Single navigation entry point: merge a search delta over the current search
  // and apply the file-only-in-tree invariant centrally so no caller can leave a
  // stale path in the URL. The selection→store mirror effect above keeps the
  // store in sync, so navigation is the single source of truth.
  const navigateGit = useCallback(
    (delta: Partial<{ commit: string | undefined; mode: GitViewMode; file: string | undefined }>) => {
      const next = { commit: search.commit, mode: search.mode, file: search.file, ...delta };
      // `file` only applies to tree mode; strip it everywhere else so a stale
      // path never lingers in the URL.
      if ((next.mode ?? "commit") !== "tree") next.file = undefined;
      navigate({ to: "/sessions/$slug/git", params: { slug }, search: next, replace: true });
    },
    [navigate, slug, search.commit, search.mode, search.file],
  );

  // Keep the current mode; only the commit changes.
  const selectCommit = useCallback((sha: string) => navigateGit({ commit: sha }), [navigateGit]);

  const selectFile = useCallback(
    (path: string | null) => navigateGit({ file: path ?? undefined }),
    [navigateGit],
  );

  const selectMode = useCallback((next: GitViewMode) => navigateGit({ mode: next }), [navigateGit]);

  // Pinned "Local Changes" row → real tab switch to the working-tree diff.
  const onLocalChanges = useCallback(() => {
    navigate({ to: "/sessions/$slug/diff", params: { slug } });
  }, [navigate, slug]);

  // Divider drag: ratio is the pointer's vertical position within the split
  // container, clamped so neither pane collapses. setPointerCapture keeps
  // move/up events flowing to the divider even when the pointer leaves it.
  const onDividerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault(); // suppress text selection at drag start
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
    },
    [],
  );
  const onDividerPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      const container = splitContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      // The pane's percentage height resolves against the container's height,
      // but its top edge is the pane's own top (below the optional refs-error
      // banner), so measure from there — this makes the divider track the
      // pointer exactly, banner or not.
      const paneTop = topPaneRef.current?.getBoundingClientRect().top ?? rect.top;
      const ratio = Math.min(0.85, Math.max(0.15, (e.clientY - paneTop) / rect.height));
      // Drive the height imperatively and commit to React state only once, on
      // pointerup: a per-move setState would re-render both panes dozens of
      // times per second.
      dragRatioRef.current = ratio;
      if (topPaneRef.current) topPaneRef.current.style.height = `${ratio * 100}%`;
    },
    [],
  );
  const onDividerPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      setDragging(false);
      // Commit the final ratio to state (writes through to the store); normal
      // renders resume driving the pane height from state.
      if (dragRatioRef.current !== null) {
        setSplitRatio(dragRatioRef.current);
        dragRatioRef.current = null;
      }
    },
    [setSplitRatio],
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
        if (status !== "found") {
          reportSeekFailure(status);
          // A genuine depth miss: the server scanned to its cap without finding
          // the commit (a commit that no longer exists surfaces the same way),
          // so fall back to HEAD by clearing ?commit= (and file, since its tree
          // path belonged to the vanished commit). A transient "error" keeps
          // ?commit= — the detail pane loads independently by sha — and only
          // toasts. "stale" already reset the log and will re-seek, so leave it.
          if (status === "too-deep") {
            navigateGit({ commit: undefined, file: undefined });
          }
        }
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
    navigateGit,
  ]);

  // Refetch refs when the session's PTY activity settles (true→false). The 300ms
  // debounced activity signal flipping off is a good proxy for "a command just
  // finished" — refs may have moved. Track the previous value so mount and
  // false→true transitions don't refetch.
  const active = sessionActivity[sessionId] ?? false;
  const prevActiveRef = useRef(active);
  useEffect(() => {
    const wasActive = prevActiveRef.current;
    prevActiveRef.current = active;
    if (wasActive && !active) refsQuery.refetch();
  }, [active, refsQuery.refetch]);

  // When the refs payload hash actually changes (not first load, not an
  // identical refetch), the log window may be invalid: reset it to page one and
  // clear attemptedShas so the seek effect re-attempts the current ?commit=
  // against the fresh history. Only a change between two DEFINED hashes acts, so
  // undefined→A (initial) and A→A (unchanged refetch) never reset or loop.
  const refsHash = refsQuery.data?.hash;
  const prevRefsHashRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const prev = prevRefsHashRef.current;
    prevRefsHashRef.current = refsHash;
    if (prev !== undefined && refsHash !== undefined && prev !== refsHash) {
      queryClient.resetQueries({ queryKey: ["git-log", sessionId] });
      attemptedShas.current.clear();
    }
  }, [refsHash, sessionId]);

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

      <div
        ref={splitContainerRef}
        className={`flex-1 min-w-0 flex flex-col ${dragging ? "select-none" : ""}`}
      >
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

        {/* Top: commit list. Height driven by the persisted split ratio for
            normal renders; overwritten imperatively during a divider drag. */}
        <div
          ref={topPaneRef}
          className="min-h-[140px] overflow-hidden"
          style={{ height: `${splitRatio * 100}%` }}
        >
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
            refSets={refSets}
            onLocalChanges={onLocalChanges}
          />
        </div>

        {/* Draggable divider between the two panes. */}
        <div
          role="separator"
          aria-orientation="horizontal"
          onPointerDown={onDividerPointerDown}
          onPointerMove={onDividerPointerMove}
          onPointerUp={onDividerPointerUp}
          onPointerCancel={onDividerPointerUp}
          className={`shrink-0 h-1 cursor-row-resize border-b border-border ${
            dragging ? "bg-primary" : "hover:bg-primary/40"
          }`}
        />

        {/* Bottom: commit detail */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <CommitDetail
            sessionId={sessionId}
            sha={selectedSha}
            mode={mode}
            onSelectMode={selectMode}
            onSelectCommit={selectCommit}
            file={search.file}
            onSelectFile={selectFile}
            refSets={refSets}
          />
        </div>
      </div>
    </div>
  );
}
