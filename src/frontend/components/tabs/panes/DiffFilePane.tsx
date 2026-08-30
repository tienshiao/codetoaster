import { useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/frontend/components/v2";
import { DiffLayout, type DiffLayoutScroll } from "@/frontend/components/diff/DiffLayout";
import { SymbolPopover, type SymbolTarget } from "@/frontend/components/SymbolPopover";
import { useComments } from "@/frontend/hooks/use-comments";
import { useHunkExpansions } from "@/frontend/hooks/use-hunk-expansions";
import { useModifierHeld } from "@/frontend/hooks/use-modifier-held";
import { useTaskDiff } from "@/frontend/hooks/use-task-diff";
import { useSymbolHighlight } from "@/frontend/hooks/use-symbol-highlight";
import { getViewState, setViewField, viewRef, type ViewRef } from "@/frontend/view-state-store";

/** The collapse sets `DiffLayout` requires and this pane has no use for: with
 * the tree and the All/Single toggle gone there is nothing to collapse, and a
 * shared frozen empty set keeps the reconcile effect from seeing a new
 * reference every render. */
const EMPTY_SET: Set<string> = new Set();

interface DiffFilePaneProps {
  taskId: string;
  /** The `diff:<path>` slot. */
  view: ViewRef;
  path: string;
  /** Opens a file at a line — where go-to-definition lands. Opening tabs is the
   * layout's business, so it arrives here as a callback. */
  onOpenFile: (path: string, line: number) => void;
}

/**
 * A `diff` tab: one file of the working-tree diff.
 *
 * The same `DiffLayout` the all-files diff uses, with the chrome for choosing a
 * file turned off — the tab already names it. Everything else is identical on
 * purpose: a comment left here and one left on the Changes tab are the same
 * review, gathered by the same Submit, because they address the same `review`
 * slot rather than one per tab.
 */
export function DiffFilePane({ taskId, view, path, onOpenFile }: DiffFilePaneProps) {
  const { data, isLoading, error: queryError, refetch } = useTaskDiff(taskId);
  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : String(queryError)
    : null;

  const review = useMemo(() => viewRef(taskId, "review"), [taskId]);
  const commentState = useComments(review);

  // The whole diff, not just this file: an expansion's key carries its path, so
  // the prune wants the full picture — and this pane's slot only ever holds
  // keys for its own file anyway.
  const { hunkExpansions, expandContext } = useHunkExpansions(taskId, "diffFile", view, data);

  const [symbolTarget, setSymbolTarget] = useState<SymbolTarget | null>(null);
  const modHeld = useModifierHeld();
  const symbolHover = useSymbolHighlight(modHeld, data);

  const files = useMemo(() => {
    const file = data?.find((f) => f.newPath === path);
    return file ? [file] : [];
  }, [data, path]);

  const scroll = useMemo<DiffLayoutScroll>(
    () => ({
      getStored: () => getViewState("diffFile", view).scrollTop,
      setStored: (top) => setViewField("diffFile", view, "scrollTop", top),
    }),
    [view],
  );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="animate-spin" size={16} />
        Loading diff...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <p>{error}</p>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw size={14} /> Retry
        </Button>
      </div>
    );
  }

  // The file was staged, reverted or committed while its tab stayed open. The
  // tab is still a legitimate thing to have open — the next edit puts the file
  // back — so this says so rather than closing itself or drawing an empty pane.
  if (files.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
        <p className="font-mono text-micro tracking-mono text-subtle-foreground">{path}</p>
        <p>No longer in the working-tree diff.</p>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw size={14} /> Refresh
        </Button>
      </div>
    );
  }

  return (
    <>
      <DiffLayout
        files={files}
        taskId={taskId}
        showFileTree={false}
        showViewModeToggle={false}
        // Not a mode the user can leave: there is one file, and "all" of it is
        // the same view under a different name.
        viewModeOverride="single"
        onViewModeOverride={() => {}}
        selectedFile={path}
        onSelectedFileChange={() => {}}
        collapsedFiles={EMPTY_SET}
        onCollapsedFilesChange={() => {}}
        treeCollapsedPaths={EMPTY_SET}
        onTreeCollapsedPathsChange={() => {}}
        scroll={scroll}
        commentState={commentState}
        commentCounts={commentState.fileCommentCounts}
        hunkExpansions={hunkExpansions}
        onExpandContext={expandContext}
        symbol={{
          modHeld,
          hoverHandlers: symbolHover,
          onSymbolClick: (name, x, y) => setSymbolTarget({ name, x, y }),
        }}
      />
      <SymbolPopover
        taskId={taskId}
        target={symbolTarget}
        onClose={() => setSymbolTarget(null)}
        onGo={(entry) => onOpenFile(entry.path, entry.line)}
      />
    </>
  );
}
