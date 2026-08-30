import { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { generatePrompt } from "./utils/generatePrompt";
import { useComments } from "./hooks/use-comments";
import { useTaskDiff } from "./hooks/use-task-diff";
import { useViewState } from "./hooks/use-view-state";
import { useHunkExpansions } from "./hooks/use-hunk-expansions";
import { getViewState, setViewField, viewRef } from "./view-state-store";
import { DiffLayout, type DiffLayoutScroll } from "./components/diff/DiffLayout";
import { Button } from "./components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./components/ui/alert-dialog";
import { useModifierHeld } from "./hooks/use-modifier-held";
import { useSymbolHighlight } from "./hooks/use-symbol-highlight";
import { maybeShowSymbolTip } from "./utils/tips";
import { SymbolPopover, type SymbolTarget } from "./components/SymbolPopover";
import { Copy, Check, Loader2, RefreshCw, Send } from "lucide-react";

interface DiffViewProps {
  taskId: string;
  /** False when the prompt could not be delivered — a task whose agent has
   * exited has no terminal to send it to. The review is kept in that case
   * rather than cleared, since the user's comments are the only copy. */
  onSubmit: (promptText: string) => boolean;
  /** Opens a file at a line — where go-to-definition lands. The tab area owns
   * opening tabs, so this arrives as a callback rather than being navigated to
   * from inside the diff. */
  onOpenFile: (path: string, line: number) => void;
}

export function DiffView({ taskId, onSubmit, onOpenFile }: DiffViewProps) {
  const { data, isLoading: loading, error: queryError, refetch } = useTaskDiff(taskId);
  const files = useMemo(() => data ?? [], [data]);
  const error = queryError ? (queryError instanceof Error ? queryError.message : String(queryError)) : null;

  // The whole-working-tree diff's slot. The review it feeds is a separate,
  // task-wide slot: comments left here and on a per-file diff are one review.
  const view = useMemo(() => viewRef(taskId, "diffAll"), [taskId]);
  const review = useMemo(() => viewRef(taskId, "review"), [taskId]);

  // Persistence-backed state supplied to the shared diff layout.
  const [selectedFile, setSelectedFile] = useViewState("diffAll", view, "selectedFile");
  const [collapsedFiles, setCollapsedFiles] = useViewState("diffAll", view, "collapsedFiles");
  // null override → derive from diff size, so the large-diff single-file
  // default stays live across refetches; the toggle buttons set it explicitly.
  const [viewModeOverride, setViewModeOverride] = useViewState("diffAll", view, "viewModeOverride");
  const [treeCollapsedPaths, setTreeCollapsedPaths] = useViewState("diffAll", view, "treeCollapsedPaths");
  const { hunkExpansions, expandContext } = useHunkExpansions(taskId, "diffAll", view, data);

  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [copied, setCopied] = useState(false);
  const [symbolTarget, setSymbolTarget] = useState<SymbolTarget | null>(null);
  const modHeld = useModifierHeld();
  const symbolHover = useSymbolHighlight(modHeld, data);

  // First time a diff with content is shown, nudge the ⌘/Ctrl-click gesture.
  useEffect(() => {
    if (data && data.length > 0) maybeShowSymbolTip();
  }, [data]);

  const commentState = useComments(review);
  const { pruneComments, clearComments } = commentState;

  // Prune comments for files/lines that left the diff. The layout owns collapse
  // pruning and single-mode reseeding; comments stay here with their store.
  useEffect(() => {
    if (!data || data.length === 0) return; // empty diff: keep drafts
    const paths = new Set(data.map((f) => f.newPath));
    // Keys mirror DiffFile's getCommentKey for addition/deletion lines
    const validLineKeys = new Set<string>();
    for (const file of data) {
      for (const hunk of file.hunks) {
        for (const line of hunk.lines) {
          if (line.type !== "addition" && line.type !== "deletion") continue;
          const lineNum = line.newLineNum ?? line.oldLineNum;
          if (lineNum) validLineKeys.add(`${file.newPath}:${lineNum}:${line.type}`);
        }
      }
    }
    const removed = pruneComments(paths, validLineKeys);
    if (removed > 0) {
      toast(`${removed} review comment${removed === 1 ? "" : "s"} removed — no longer in diff`);
    }
  }, [data, pruneComments]);

  const handleSubmitReview = useCallback(() => {
    const prompt = generatePrompt({
      comments: commentState.comments,
      files,
      hunkExpansions,
    });
    setPromptText(prompt);
    setShowSubmitDialog(true);
  }, [commentState.comments, files, hunkExpansions]);

  const handleConfirmSubmit = useCallback(() => {
    setShowSubmitDialog(false);
    // Only once it has actually gone somewhere. Comments persist in the
    // view-state store across unmounts, so they have to be dropped explicitly
    // or the next submit resends the same feedback — but dropping them on a
    // submit that went nowhere destroys a review the user cannot get back.
    if (onSubmit(promptText)) {
      clearComments();
      return;
    }
    // Keeping the review is only half of it. Without this the dialog simply
    // closes: no navigation, no message, nothing — and the user has every
    // reason to believe a review that went nowhere was sent.
    toast.error("Could not send the review", {
      description: "This task has no running agent to send it to. Reopen it and try again.",
    });
  }, [onSubmit, promptText, clearComments]);

  // Stable scroll persistence handles for the layout's restore/persist/reseed.
  const scroll = useMemo<DiffLayoutScroll>(
    () => ({
      getStored: () => getViewState("diffAll", view).scrollTop,
      setStored: (top) => setViewField("diffAll", view, "scrollTop", top),
    }),
    [view],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm gap-2">
        <Loader2 className="animate-spin" size={16} />
        Loading diff...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm gap-3">
        <p>{error}</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw size={14} /> Retry
        </Button>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm gap-3">
        <p>No changes detected</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
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
        viewModeOverride={viewModeOverride}
        onViewModeOverride={setViewModeOverride}
        selectedFile={selectedFile}
        onSelectedFileChange={setSelectedFile}
        collapsedFiles={collapsedFiles}
        onCollapsedFilesChange={setCollapsedFiles}
        treeCollapsedPaths={treeCollapsedPaths}
        onTreeCollapsedPathsChange={setTreeCollapsedPaths}
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
        toolbarExtra={
          commentState.comments.size > 0 ? (
            <Button size="sm" onClick={handleSubmitReview} className="ml-auto gap-1.5 h-7 text-xs">
              <Send size={12} />
              Submit Review ({commentState.comments.size})
            </Button>
          ) : null
        }
      />

      {/* Submit confirmation dialog */}
      <AlertDialog open={showSubmitDialog} onOpenChange={setShowSubmitDialog}>
        <AlertDialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <AlertDialogHeader>
            <AlertDialogTitle>Send review to terminal?</AlertDialogTitle>
            <AlertDialogDescription>
              This will send the following prompt to the terminal's stdin as a single write:
            </AlertDialogDescription>
          </AlertDialogHeader>
          <pre className="flex-1 overflow-auto bg-muted rounded-md p-3 text-xs text-foreground whitespace-pre-wrap border border-border">
            {promptText}
          </pre>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(promptText);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="gap-1.5"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <AlertDialogAction onClick={handleConfirmSubmit}>
              Send to Terminal
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SymbolPopover
        taskId={taskId}
        target={symbolTarget}
        onClose={() => setSymbolTarget(null)}
        onGo={(entry) => onOpenFile(entry.path, entry.line)}
      />
    </>
  );
}
