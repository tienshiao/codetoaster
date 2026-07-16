import { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { generatePrompt } from "./utils/generatePrompt";
import { useComments } from "./hooks/use-comments";
import { useSessionDiff } from "./hooks/use-session-diff";
import { useViewState } from "./hooks/use-view-state";
import { getViewState, pruneMap } from "./view-state-store";
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
import { applySyntaxToLine } from "./utils/wordDiff";
import { getLanguageFromPath } from "./utils/languageDetection";
import { useModifierHeld } from "./hooks/use-modifier-held";
import { useSymbolHighlight } from "./hooks/use-symbol-highlight";
import { maybeShowSymbolTip } from "./utils/tips";
import { SymbolPopover, type SymbolTarget } from "./components/SymbolPopover";
import type { DiffHunk, DiffLine } from "./types/diff";
import type { LineTokens } from "../types/highlight";
import { Copy, Check, Loader2, RefreshCw, Send } from "lucide-react";

interface DiffViewProps {
  sessionId: string;
  onSubmit: (promptText: string) => void;
}

const CONTEXT_LINES = 20;

export function DiffView({ sessionId, onSubmit }: DiffViewProps) {
  const { data, isLoading: loading, error: queryError, refetch } = useSessionDiff(sessionId);
  const files = useMemo(() => data ?? [], [data]);
  const error = queryError ? (queryError instanceof Error ? queryError.message : String(queryError)) : null;

  // Persistence-backed state supplied to the shared diff layout.
  const [selectedFile, setSelectedFile] = useViewState(sessionId, "diffView", "selectedFile");
  const [collapsedFiles, setCollapsedFiles] = useViewState(sessionId, "diffView", "collapsedFiles");
  // null override → derive from diff size, so the large-diff single-file
  // default stays live across refetches; the toggle buttons set it explicitly.
  const [viewModeOverride, setViewModeOverride] = useViewState(sessionId, "diffView", "viewModeOverride");
  const [treeCollapsedPaths, setTreeCollapsedPaths] = useViewState(sessionId, "diffView", "treeCollapsedPaths");
  const [hunkExpansions, setHunkExpansions] = useViewState(sessionId, "diffView", "hunkExpansions");

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

  const commentState = useComments(sessionId);
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

  // Drop loaded context expansions that no longer line up with the diff. Keys
  // are `${filePath}:${hunkIndex}` (see DiffFile). An expansion is kept only
  // while its stored context lines are still contiguous with that hunk's
  // current boundaries — if the file changed underneath (edited from another
  // tab, committed away), stale lines would render against the wrong hunk,
  // corrupt further expand-range math, and leak into the review prompt.
  useEffect(() => {
    if (!data) return;
    const filesByPath = new Map(data.map((f) => [f.newPath, f]));
    setHunkExpansions((prev) =>
      pruneMap(prev, (key, exp) => {
        const sep = key.lastIndexOf(":");
        const path = key.slice(0, sep);
        const hunk = filesByPath.get(path)?.hunks[Number(key.slice(sep + 1))];
        if (!hunk) return false;
        const lastBefore = exp.beforeLines[exp.beforeLines.length - 1];
        if (lastBefore && lastBefore.newLineNum !== hunk.newStart - 1) return false;
        const firstAfter = exp.afterLines[0];
        if (firstAfter && firstAfter.newLineNum !== hunk.newStart + hunk.newCount) return false;
        return true;
      }),
    );
  }, [data, setHunkExpansions]);

  const handleExpandContext = useCallback(
    async (
      filePath: string,
      hunkIndex: number,
      direction: "before" | "after",
      hunk: DiffHunk,
      prevHunk: DiffHunk | null,
      nextHunk: DiffHunk | null
    ) => {
      const expansionKey = `${filePath}:${hunkIndex}`;
      const existing = hunkExpansions.get(expansionKey) || {
        beforeLines: [],
        afterLines: [],
        canExpandBefore: true,
        canExpandAfter: true,
      };

      let startLine: number;
      let endLine: number;

      if (direction === "before") {
        const currentFirstLine = hunk.newStart - existing.beforeLines.length;
        endLine = currentFirstLine - 1;
        startLine = Math.max(1, endLine - CONTEXT_LINES + 1);

        if (prevHunk) {
          const prevExpansionKey = `${filePath}:${hunkIndex - 1}`;
          const prevExpansion = hunkExpansions.get(prevExpansionKey);
          const prevLoadedAfterCount = prevExpansion?.afterLines.length || 0;
          const prevHunkEnd = prevHunk.newStart + prevHunk.newCount - 1;
          const prevEffectiveEnd = prevHunkEnd + prevLoadedAfterCount;
          startLine = Math.max(startLine, prevEffectiveEnd + 1);
        }
      } else {
        const hunkEnd = hunk.newStart + hunk.newCount - 1;
        startLine = hunkEnd + existing.afterLines.length + 1;
        endLine = startLine + CONTEXT_LINES - 1;

        if (nextHunk) {
          const nextExpansionKey = `${filePath}:${hunkIndex + 1}`;
          const nextExpansion = hunkExpansions.get(nextExpansionKey);
          const nextLoadedBeforeCount = nextExpansion?.beforeLines.length || 0;
          const nextEffectiveStart = nextHunk.newStart - nextLoadedBeforeCount;
          endLine = Math.min(endLine, nextEffectiveStart - 1);
        }
      }

      if (startLine > endLine) return;

      try {
        const res = await fetch(
          `/api/sessions/${sessionId}/context?file=${encodeURIComponent(filePath)}&start=${startLine}&end=${endLine}`
        );
        if (!res.ok) return;
        const data = await res.json();

        const langConfig = getLanguageFromPath(filePath);
        const serverTokens = data.tokens as LineTokens[] | null | undefined;
        const contextLines: DiffLine[] = data.lines.map((l: { lineNum: number; content: string }, i: number) => {
          const line: DiffLine = {
            type: "context" as const,
            content: l.content,
            oldLineNum: l.lineNum,
            newLineNum: l.lineNum,
          };
          // Prefer server tokens (validated inside applySyntaxToLine), else regex.
          line.segments = applySyntaxToLine(l.content, serverTokens?.[i] ?? null, langConfig);
          return line;
        });

        setHunkExpansions((prev) => {
          const next = new Map(prev);
          const current = next.get(expansionKey) || {
            beforeLines: [],
            afterLines: [],
            canExpandBefore: true,
            canExpandAfter: true,
          };

          if (direction === "before") {
            next.set(expansionKey, {
              ...current,
              beforeLines: [...contextLines, ...current.beforeLines],
              canExpandBefore: startLine > 1 && data.lines.length === (endLine - startLine + 1),
            });
          } else {
            next.set(expansionKey, {
              ...current,
              afterLines: [...current.afterLines, ...contextLines],
              canExpandAfter: data.hasMore && data.lines.length === (endLine - startLine + 1),
            });
          }
          return next;
        });
      } catch {
        // ignore
      }
    },
    [sessionId, hunkExpansions]
  );

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
    onSubmit(promptText);
    // Comments persist in the view-state store across unmounts, so drop them
    // explicitly — otherwise the next submit would resend the same feedback
    clearComments();
  }, [onSubmit, promptText, clearComments]);

  // Stable scroll persistence handles for the layout's restore/persist/reseed.
  const scroll = useMemo<DiffLayoutScroll>(
    () => ({
      getStored: () => getViewState(sessionId).diffView.scrollTop,
      setStored: (top) => {
        getViewState(sessionId).diffView.scrollTop = top;
      },
    }),
    [sessionId],
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
        sessionId={sessionId}
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
        onExpandContext={handleExpandContext}
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

      <SymbolPopover sessionId={sessionId} target={symbolTarget} onClose={() => setSymbolTarget(null)} />
    </>
  );
}
