import { useMemo } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/frontend/components/v2";
import { CommitList } from "@/frontend/components/git/CommitList";
import { RefSidebar, type RefSidebarHeadExpanded } from "@/frontend/components/git/RefSidebar";
import { useGitHistory } from "@/frontend/hooks/use-git-history";
import { useViewState } from "@/frontend/hooks/use-view-state";
import { getViewState, setViewField, type ViewRef } from "@/frontend/view-state-store";

interface HistoryPaneProps {
  taskId: string;
  /** The `history` slot. */
  view: ViewRef;
  /** Selecting a commit opens its own tab. There is no detail pane below the
   * graph in v2 — a commit is a tab, which is what makes two of them comparable
   * side by side. */
  onOpenCommit: (sha: string) => void;
  /** The pinned "Local Changes" row: the working-tree diff, which is the
   * `diffAll` tab. */
  onOpenChanges: () => void;
}

/**
 * A `history` tab: the ref sidebar and the commit graph.
 *
 * v1's git route was this plus a commit detail under a draggable divider, so it
 * carried a split ratio and a URL selection. Both are gone: the detail is a tab
 * of its own and nothing here is addressed from outside, which leaves the graph
 * as what it always was — a list you pick from.
 */
export function HistoryPane({ taskId, view, onOpenCommit, onOpenChanges }: HistoryPaneProps) {
  const { logQuery, refsQuery, refSets, commits, pendingRefSha, selectRef } = useGitHistory(
    taskId,
    onOpenCommit,
  );

  const [refsClosedSections, setRefsClosedSections] = useViewState(
    "history",
    view,
    "refsClosedSections",
  );
  const [refsExpanded, setRefsExpanded] = useViewState("history", view, "refsExpanded");

  // Read/write handle rather than a value: RefSidebar's HEAD-reveal effect has
  // to read and write this synchronously, so it runs once per HEAD value and
  // not once per remount — which would undo a user's collapse of HEAD's
  // ancestor folders on every tab switch.
  const headExpanded = useMemo<RefSidebarHeadExpanded>(
    () => ({
      get: () => getViewState("history", view).refsHeadExpandedFor,
      set: (branch) => setViewField("history", view, "refsHeadExpandedFor", branch),
    }),
    [view],
  );

  if (logQuery.isLoading || refsQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="animate-spin" size={16} /> Loading history...
      </div>
    );
  }

  if (logQuery.error) {
    const message =
      logQuery.error instanceof Error ? logQuery.error.message : String(logQuery.error);
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <p>{message}</p>
        <Button variant="outline" onClick={() => logQuery.refetch()}>
          <RefreshCw size={14} /> Retry
        </Button>
      </div>
    );
  }

  if (commits.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No commits in this repository.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-row">
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

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Refs failed but the log succeeded: surface it without blanking the
            view — branch/tag decorations and the HEAD default are just missing. */}
        {refsQuery.error && (
          <div className="flex h-row shrink-0 items-center gap-2 border-b border-border bg-chrome px-3 text-micro text-warning">
            <span className="flex-1">Could not load branch/tag refs.</span>
            <button
              type="button"
              onClick={() => refsQuery.refetch()}
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              <RefreshCw size={12} /> Retry
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-hidden">
          <CommitList
            commits={commits}
            // No row is "the" selection: picking one opens a tab rather than
            // filling a pane, so the graph has nothing to stay highlighted for.
            selectedSha={undefined}
            onSelect={onOpenCommit}
            hasMore={logQuery.hasNextPage ?? false}
            isFetchingNextPage={logQuery.isFetchingNextPage}
            // Paused while a ref-seek (fetchUntil) is in flight so the two
            // append paths can't compute pages from the same cursor.
            onLoadMore={() => {
              if (!pendingRefSha) logQuery.fetchNextPage();
            }}
            refSets={refSets}
            onLocalChanges={onOpenChanges}
            initialScrollTop={getViewState("history", view).listScrollTop}
            onScrollTopChange={(top) => setViewField("history", view, "listScrollTop", top)}
          />
        </div>
      </div>
    </div>
  );
}
