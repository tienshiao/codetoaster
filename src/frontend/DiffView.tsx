import { useState, useEffect, useCallback, useRef } from "react";
import { generatePrompt } from "./utils/generatePrompt";
import { useComments } from "./hooks/use-comments";
import { useSessionDiff } from "./hooks/use-session-diff";
import { FileTree } from "./components/diff/FileTree";
import { DiffFile } from "./components/diff/DiffFile";
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
import { tokenizeLine, mergeTokens } from "./utils/syntaxHighlight";
import { getLanguageFromPath } from "./utils/languageDetection";
import type { DiffHunk, HunkExpansionState, DiffLine } from "./types/diff";
import { ChevronLeft, ChevronRight, Copy, Check, Loader2, RefreshCw, Send } from "lucide-react";
import "./components/diff/DiffView.css";

interface DiffViewProps {
  sessionId: string;
  onSubmit: (promptText: string) => void;
}

const CONTEXT_LINES = 20;
const FILE_COUNT_THRESHOLD = 30;
const TOTAL_LINES_THRESHOLD = 1500;

export function DiffView({ sessionId, onSubmit }: DiffViewProps) {
  const { data: files = [], isLoading: loading, error: queryError, refetch } = useSessionDiff(sessionId);
  const error = queryError ? (queryError instanceof Error ? queryError.message : String(queryError)) : null;
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [hunkExpansions, setHunkExpansions] = useState<Map<string, HunkExpansionState>>(new Map());
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<"all" | "single">("all");
  const diffContainerRef = useRef<HTMLDivElement>(null);
  const fileRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const commentState = useComments();

  // Auto-enable single-file mode for large diffs
  useEffect(() => {
    if (files.length === 0) return;
    const totalLines = files.reduce((sum, f) => sum + f.additions + f.deletions, 0);
    const isLarge = files.length >= FILE_COUNT_THRESHOLD || totalLines >= TOTAL_LINES_THRESHOLD;

    if (isLarge && files[0]) {
      setViewMode("single");
      setSelectedFile(files[0].newPath);
      setExpandedFiles(new Set([files[0].newPath]));
    } else {
      setViewMode("all");
      setExpandedFiles(new Set(files.map((f) => f.newPath)));
    }
  }, [files]);

  const navigateToFile = useCallback((path: string) => {
    setSelectedFile(path);
    setExpandedFiles((prev) => new Set(prev).add(path));
    if (viewMode === "all") {
      const el = fileRefs.current.get(path);
      if (el) {
        el.scrollIntoView({ behavior: "instant", block: "start" });
      }
    } else {
      diffContainerRef.current?.scrollTo({ top: 0 });
    }
  }, [viewMode]);

  const handleSelectFile = useCallback((path: string) => {
    navigateToFile(path);
  }, [navigateToFile]);

  const navigateToPrevFile = useCallback(() => {
    if (!selectedFile) return;
    const idx = files.findIndex((f) => f.newPath === selectedFile);
    const prev = files[idx - 1];
    if (idx > 0 && prev) {
      navigateToFile(prev.newPath);
    }
  }, [selectedFile, files, navigateToFile]);

  const navigateToNextFile = useCallback(() => {
    if (!selectedFile) return;
    const idx = files.findIndex((f) => f.newPath === selectedFile);
    const next = files[idx + 1];
    if (idx < files.length - 1 && next) {
      navigateToFile(next.newPath);
    }
  }, [selectedFile, files, navigateToFile]);

  // Keyboard navigation in single-file mode
  useEffect(() => {
    if (viewMode !== "single") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft") {
        navigateToPrevFile();
      } else if (e.key === "ArrowRight") {
        navigateToNextFile();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [viewMode, navigateToPrevFile, navigateToNextFile]);

  // Track which file is visible during scroll in "all files" mode
  useEffect(() => {
    if (viewMode !== "all" || files.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Find the topmost intersecting file
        let topEntry: IntersectionObserverEntry | null = null;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (!topEntry || entry.boundingClientRect.top < topEntry.boundingClientRect.top) {
              topEntry = entry;
            }
          }
        }
        if (topEntry) {
          const path = (topEntry.target as HTMLElement).dataset.filePath;
          if (path) {
            setSelectedFile(path);
          }
        }
      },
      { threshold: 0, rootMargin: "0px 0px -70% 0px" }
    );

    for (const [path, el] of fileRefs.current) {
      el.dataset.filePath = path;
      observer.observe(el);
    }

    return () => observer.disconnect();
  }, [viewMode, files]);

  const handleToggleFile = useCallback((path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

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
        const contextLines: DiffLine[] = data.lines.map((l: { lineNum: number; content: string }) => {
          const line: DiffLine = {
            type: "context" as const,
            content: l.content,
            oldLineNum: l.lineNum,
            newLineNum: l.lineNum,
          };
          if (langConfig) {
            const tokens = mergeTokens(tokenizeLine(l.content, langConfig));
            line.segments = tokens.map(t => ({
              text: t.text,
              highlighted: false,
              syntaxType: t.type || undefined,
            }));
          }
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

  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

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
  }, [onSubmit, promptText]);

  const selectedFileIndex = selectedFile ? files.findIndex((f) => f.newPath === selectedFile) : -1;

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

  const renderFiles = () => {
    if (viewMode === "single") {
      const file = files.find((f) => f.newPath === selectedFile);
      if (!file) return null;
      return (
        <div
          key={file.newPath}
          ref={(el) => {
            if (el) fileRefs.current.set(file.newPath, el);
            else fileRefs.current.delete(file.newPath);
          }}
        >
          <DiffFile
            file={file}
            isExpanded={true}
            onToggle={() => handleToggleFile(file.newPath)}
            hunkExpansions={hunkExpansions}
            onExpandContext={handleExpandContext}
            commentState={commentState}
            sessionId={sessionId}
          />
        </div>
      );
    }

    return files.map((file) => (
      <div
        key={file.newPath}
        ref={(el) => {
          if (el) fileRefs.current.set(file.newPath, el);
          else fileRefs.current.delete(file.newPath);
        }}
      >
        <DiffFile
          file={file}
          isExpanded={expandedFiles.has(file.newPath)}
          onToggle={() => handleToggleFile(file.newPath)}
          hunkExpansions={hunkExpansions}
          onExpandContext={handleExpandContext}
          commentState={commentState}
          sessionId={sessionId}
        />
      </div>
    ));
  };

  return (
    <div className="flex h-full">
      {/* File tree sidebar */}
      <div className="w-[280px] shrink-0">
        <FileTree
          files={files}
          selectedFile={selectedFile}
          onSelectFile={handleSelectFile}
          totalAdditions={totalAdditions}
          totalDeletions={totalDeletions}
          commentCounts={commentState.fileCommentCounts}
        />
      </div>

      {/* Diff content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* View mode toggle + submit */}
        <div className="flex items-center text-xs px-4 py-2 shrink-0">
          <div className="inline-flex rounded-md border border-border overflow-hidden">
            <button
              className={`px-2.5 py-1 transition-colors ${viewMode === "all" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"}`}
              onClick={() => setViewMode("all")}
            >
              All Files
            </button>
            <button
              className={`px-2.5 py-1 transition-colors border-l border-border ${viewMode === "single" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"}`}
              onClick={() => {
                setViewMode("single");
                if (!selectedFile && files[0]) {
                  setSelectedFile(files[0].newPath);
                }
              }}
            >
              Single File
            </button>
          </div>
          {commentState.comments.size > 0 && (
            <Button size="sm" onClick={handleSubmitReview} className="ml-auto gap-1.5 h-7 text-xs">
              <Send size={12} />
              Submit Review ({commentState.comments.size})
            </Button>
          )}
        </div>

        {/* Scrollable file diffs */}
        <div ref={diffContainerRef} className="flex-1 overflow-y-auto px-4 flex flex-col gap-3 relative">
          {renderFiles()}

        {/* Floating prev/next navigation for single-file mode */}
        {viewMode === "single" && (
          <div className="sticky bottom-4 z-50 flex items-center justify-center pointer-events-none">
            <div className="pointer-events-auto flex items-center gap-3 px-5 py-2.5 bg-popover border border-border rounded-lg shadow-lg">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={navigateToPrevFile}
                disabled={selectedFileIndex <= 0}
              >
                <ChevronLeft size={14} /> Prev
              </Button>
              <span className="text-xs text-muted-foreground min-w-[70px] text-center">
                {selectedFileIndex + 1} of {files.length}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={navigateToNextFile}
                disabled={selectedFileIndex >= files.length - 1}
              >
                Next <ChevronRight size={14} />
              </Button>
            </div>
          </div>
        )}
        </div>
      </div>

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
    </div>
  );
}
