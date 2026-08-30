import { useMemo, useEffect, useCallback, useRef, useState } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { Loader2, RefreshCw } from "lucide-react";
import { getViewState, setViewField, viewRef } from "../../view-state-store";
import { useViewState } from "../../hooks/use-view-state";
import { useGitHistory } from "../../hooks/use-git-history";
import { Button } from "../ui/button";
import { CommitList } from "./CommitList";
import { CommitDetail } from "./CommitDetail";
import { RefSidebar, type RefSidebarHeadExpanded } from "./RefSidebar";
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

  // Single navigation entry point: merge a search delta over the current search
  // and apply the file-only-in-tree invariant centrally so no caller can leave a
  // stale path in the URL. The selection→store mirror effect below keeps the
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

  // Attempted shas are remembered so a deep-link miss (too-deep/error) never
  // re-seeks and loops. A refs change invalidates the loaded log and with it the
  // answer to "have we already tried this one?", so the seek effect re-attempts
  // the current ?commit= against the fresh history.
  const attemptedShas = useRef<Set<string>>(new Set());
  const forgetAttempts = useCallback(() => attemptedShas.current.clear(), []);
  const {
    logQuery,
    refsQuery,
    refSets,
    commits,
    pendingRefSha,
    setPendingRefSha,
    selectRef,
    reportSeekFailure,
    fetchUntil,
  } = useGitHistory(sessionId, selectCommit, forgetAttempts);

  // The history view's slot (graph + ref sidebar), and v1's nav shim slot.
  const history = useMemo(() => viewRef(sessionId, "history"), [sessionId]);
  const nav = useMemo(() => viewRef(sessionId, "nav"), [sessionId]);

  // Draggable top/bottom split. Backed by the history slot (GitView remounts
  // per session via route key, so the hook's mount-time bind restores the
  // persisted ratio), written back once per drag on pointerup.
  const [splitRatio, setSplitRatio] = useViewState("history", history, "splitRatio");
  const [refsClosedSections, setRefsClosedSections] = useViewState("history", history, "refsClosedSections");
  const [refsExpanded, setRefsExpanded] = useViewState("history", history, "refsExpanded");

  // Read/write handle rather than a value: RefSidebar's HEAD-reveal effect has
  // to read and write this synchronously, so it runs once per HEAD value and
  // not once per remount — which would undo a user's collapse of HEAD's
  // ancestor folders on every tab switch.
  const headExpanded = useMemo<RefSidebarHeadExpanded>(
    () => ({
      get: () => getViewState("history", history).refsHeadExpandedFor,
      set: (branch) => setViewField("history", history, "refsHeadExpandedFor", branch),
    }),
    [history],
  );
  const [dragging, setDragging] = useState(false);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  // The top pane whose height the divider drives. During a drag the height is
  // written imperatively on this element (see onDividerPointerMove).
  const topPaneRef = useRef<HTMLDivElement>(null);
  // Last ratio produced by the in-flight drag; committed to state on pointerup.
  const dragRatioRef = useRef<number | null>(null);

  // ?commit= is the source of truth; fall back to HEAD when unset, and to the
  // newest loaded commit (topo-order) when refs are unavailable (e.g. the refs
  // request failed) so a selection is still made.
  const selectedSha = search.commit ?? refsQuery.data?.head.sha ?? commits[0]?.hash;

  // The bottom-pane mode persists independently of selection; default to commit.
  const mode: GitViewMode = search.mode ?? "commit";

  // The detail pane's slot, keyed by the *resolved* hash rather than by the sha
  // as the URL spells it.
  //
  // A deep link carries an abbreviated sha while log rows are full 40-char
  // hashes, so clicking that same commit's row rewrites the URL to the full one
  // — and a slot keyed on the URL form changed identity under a pane that was
  // still showing the same commit, emptying its expanded folders, its Changes
  // selection and its scroll offset with nothing on screen to explain it. The
  // full hash is also what v2's `commit:` tab keys off, so the two stop
  // addressing different slots for one commit. With no selection at all the
  // pane renders its empty state and the slot is never written.
  const resolvedSha = useMemo(
    () =>
      selectedSha
        ? (commits.find((c) => shaMatches(c.hash, selectedSha))?.hash ?? selectedSha)
        : "",
    [commits, selectedSha],
  );
  const commitView = useMemo(
    () => viewRef(sessionId, `commit:${resolvedSha}`),
    [sessionId, resolvedSha],
  );

  // Mirror the explicit URL selection into the nav slot so tab/session switches
  // restore it (session-nav reads gitCommit/gitMode/gitFile).
  useEffect(() => {
    setViewField("nav", nav, "gitCommit", search.commit);
    setViewField("nav", nav, "gitMode", search.mode);
    setViewField("nav", nav, "gitFile", search.file);
  }, [nav, search.commit, search.mode, search.file]);

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

  // Deep link: ?commit= may point past the loaded window (a sidebar click is the
  // only other path that pages there). When the log has loaded, a commit is
  // requested, and nothing loaded matches it, seek the same way selectRef does.
  // The URL already carries the selection, so on "found" we let CommitList's own
  // scroll effect reveal it — no selectCommit here. Attempted shas are remembered
  // so a miss (too-deep/error) never re-seeks and loops.
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
    setPendingRefSha,
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
        closedSections={refsClosedSections}
        onClosedSectionsChange={setRefsClosedSections}
        refsExpanded={refsExpanded}
        onRefsExpandedChange={setRefsExpanded}
        headExpanded={headExpanded}
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
            initialScrollTop={getViewState("history", history).listScrollTop}
            onScrollTopChange={(top) => setViewField("history", history, "listScrollTop", top)}
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
            view={commitView}
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
