import {
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  useMemo,
  type Dispatch,
  type SetStateAction,
  type ReactNode,
  type DOMAttributes,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { FileTree } from "./FileTree";
import { DiffFile } from "./DiffFile";
import { sumDiffStats } from "./DiffStat";
import { Button } from "../ui/button";
import { pruneSet } from "../../view-state-store";
import { symbolAtPoint } from "../../utils/symbolClick";
import type { FileDiff, DiffHunk, HunkExpansionState } from "../../types/diff";
import type { UseCommentsReturn } from "../../hooks/use-comments";
import "./DiffView.css";

const FILE_COUNT_THRESHOLD = 30;
const TOTAL_LINES_THRESHOLD = 1500;

// Optional Cmd/Ctrl-click go-to-symbol wiring. When absent, the code area gets
// no symbol-clickable affordance (the git changes view has none).
export interface DiffLayoutSymbol {
  modHeld: boolean;
  hoverHandlers: DOMAttributes<HTMLDivElement>;
  onSymbolClick: (name: string, x: number, y: number) => void;
}

// Optional scroll persistence. When absent, reseeds still scroll to top
// visually but nothing is stored or restored.
export interface DiffLayoutScroll {
  getStored: () => number;
  setStored: (top: number) => void;
}

interface DiffLayoutProps {
  files: FileDiff[];
  sessionId?: string;

  // View-mode override (controlled); the large-diff → single default derives
  // from diff size inside the core so it stays live across refetches.
  viewModeOverride: "all" | "single" | null;
  onViewModeOverride: (mode: "all" | "single") => void;

  // Selected file (controlled, setState-style so the reconcile can reseed).
  selectedFile: string | null;
  onSelectedFileChange: Dispatch<SetStateAction<string | null>>;

  // Files the user explicitly collapsed in "all" mode (controlled, setState-style).
  collapsedFiles: Set<string>;
  onCollapsedFilesChange: Dispatch<SetStateAction<Set<string>>>;

  // FileTree directory collapse state (controlled; passed straight to FileTree
  // so a reused tree never writes the diff tab's persisted state).
  treeCollapsedPaths: Set<string>;
  onTreeCollapsedPathsChange: Dispatch<SetStateAction<Set<string>>>;

  scroll?: DiffLayoutScroll;

  // Optional pass-throughs to DiffFile / FileTree.
  commentState?: UseCommentsReturn;
  hunkExpansions?: Map<string, HunkExpansionState>;
  onExpandContext?: (
    filePath: string,
    hunkIndex: number,
    direction: "before" | "after",
    hunk: DiffHunk,
    prevHunk: DiffHunk | null,
    nextHunk: DiffHunk | null,
  ) => void;
  commentCounts?: Map<string, number>;
  imageRefs?: { old: string; new: string };

  // Extra toolbar content, right-aligned (e.g. the Submit Review button).
  toolbarExtra?: ReactNode;

  symbol?: DiffLayoutSymbol;
}

// The comment-free presentation + navigation core shared by the working-tree
// diff view and the git commit "Changes" view: FileTree sidebar, All/Single
// toggle, scrollable DiffFile list, active-file tracking, and single-file nav.
// All persistence-backed state is injected so each consumer owns its own store.
export function DiffLayout({
  files,
  sessionId,
  viewModeOverride,
  onViewModeOverride,
  selectedFile,
  onSelectedFileChange,
  collapsedFiles,
  onCollapsedFilesChange,
  treeCollapsedPaths,
  onTreeCollapsedPathsChange,
  scroll,
  commentState,
  hunkExpansions,
  onExpandContext,
  commentCounts,
  imageRefs,
  toolbarExtra,
  symbol,
}: DiffLayoutProps) {
  const diffContainerRef = useRef<HTMLDivElement>(null);
  const fileRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const totalLines = files.reduce((sum, f) => sum + f.additions + f.deletions, 0);
  const isLargeDiff = files.length >= FILE_COUNT_THRESHOLD || totalLines >= TOTAL_LINES_THRESHOLD;
  const viewMode: "all" | "single" = viewModeOverride ?? (isLargeDiff ? "single" : "all");

  // Reconcile persisted state against the current diff: prune user collapses for
  // files that left the diff and seed/keep a selection in single mode.
  useEffect(() => {
    if (files.length === 0) return; // nothing to reconcile against
    const paths = new Set(files.map((f) => f.newPath));
    onCollapsedFilesChange((prev) => pruneSet(prev, paths));
    onSelectedFileChange((prev) => {
      if (viewMode === "single") {
        if (prev && paths.has(prev)) return prev;
        // Reseeding to a different file: the scroll offset saved for the old
        // selection is meaningless there. (Idempotent, safe to run twice.)
        scroll?.setStored(0);
        diffContainerRef.current?.scrollTo({ top: 0 });
        return files[0]?.newPath ?? null;
      }
      return prev && paths.has(prev) ? prev : null;
    });
  }, [files, viewMode, scroll, onCollapsedFilesChange, onSelectedFileChange]);

  // Restore scroll position once the diff has rendered. The IntersectionObserver
  // below is a passive effect and attaches after this layout effect, so it then
  // reports the file at the restored offset — consistent, no guard needed.
  const restoredScrollRef = useRef(false);
  useLayoutEffect(() => {
    if (restoredScrollRef.current || files.length === 0 || !diffContainerRef.current) return;
    restoredScrollRef.current = true;
    const storedTop = scroll?.getStored() ?? 0;
    if (storedTop > 0) {
      diffContainerRef.current.scrollTop = storedTop;
    }
  }, [files, scroll]);

  const expandFile = useCallback((path: string) => {
    onCollapsedFilesChange((prev) => {
      if (!prev.has(path)) return prev;
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
  }, [onCollapsedFilesChange]);

  const navigateToFile = useCallback((path: string) => {
    onSelectedFileChange(path);
    expandFile(path);
    if (viewMode === "all") {
      const el = fileRefs.current.get(path);
      if (el) {
        el.scrollIntoView({ behavior: "instant", block: "start" });
      }
    } else {
      diffContainerRef.current?.scrollTo({ top: 0 });
    }
  }, [viewMode, onSelectedFileChange, expandFile]);

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
            onSelectedFileChange(path);
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
  }, [viewMode, files, onSelectedFileChange]);

  const handleToggleFile = useCallback((path: string) => {
    onCollapsedFilesChange((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, [onCollapsedFilesChange]);

  const { additions: totalAdditions, deletions: totalDeletions } = useMemo(
    () => sumDiffStats(files),
    [files],
  );

  const selectedFileIndex = selectedFile ? files.findIndex((f) => f.newPath === selectedFile) : -1;

  const renderFiles = () => {
    if (viewMode === "single") {
      // fall back to the first file for the frame before reconcile seeds a selection
      const file = files.find((f) => f.newPath === selectedFile) ?? files[0];
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
            onExpandContext={onExpandContext}
            commentState={commentState}
            sessionId={sessionId}
            imageRefs={imageRefs}
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
          isExpanded={!collapsedFiles.has(file.newPath)}
          onToggle={() => handleToggleFile(file.newPath)}
          hunkExpansions={hunkExpansions}
          onExpandContext={onExpandContext}
          commentState={commentState}
          sessionId={sessionId}
          imageRefs={imageRefs}
        />
      </div>
    ));
  };

  const symbolClasses = symbol ? `symbol-clickable ${symbol.modHeld ? "mod-held" : ""}` : "";

  return (
    <div className="flex h-full">
      {/* File tree sidebar */}
      <div className="w-[280px] shrink-0">
        <FileTree
          sessionId={sessionId}
          files={files}
          selectedFile={selectedFile}
          onSelectFile={handleSelectFile}
          totalAdditions={totalAdditions}
          totalDeletions={totalDeletions}
          commentCounts={commentCounts}
          collapsedPaths={treeCollapsedPaths}
          onCollapsedPathsChange={onTreeCollapsedPathsChange}
        />
      </div>

      {/* Diff content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* View mode toggle + toolbar extras */}
        <div className="flex items-center text-xs px-4 py-2 shrink-0">
          <div className="inline-flex rounded-md border border-border overflow-hidden">
            <button
              className={`px-2.5 py-1 transition-colors ${viewMode === "all" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"}`}
              onClick={() => onViewModeOverride("all")}
            >
              All Files
            </button>
            <button
              className={`px-2.5 py-1 transition-colors border-l border-border ${viewMode === "single" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"}`}
              onClick={() => {
                onViewModeOverride("single");
                if (!selectedFile && files[0]) {
                  onSelectedFileChange(files[0].newPath);
                }
              }}
            >
              Single File
            </button>
          </div>
          {toolbarExtra}
        </div>

        {/* Scrollable file diffs */}
        <div
          ref={diffContainerRef}
          className={`flex-1 overflow-y-auto px-4 flex flex-col gap-3 relative ${symbolClasses}`}
          onScroll={(e) => {
            scroll?.setStored(e.currentTarget.scrollTop);
          }}
          {...(symbol?.hoverHandlers ?? {})}
          onClickCapture={
            symbol
              ? (e) => {
                  if (!(e.metaKey || e.ctrlKey)) return;
                  const name = symbolAtPoint(e.clientX, e.clientY);
                  if (name) {
                    e.preventDefault();
                    e.stopPropagation();
                    symbol.onSymbolClick(name, e.clientX, e.clientY);
                  }
                }
              : undefined
          }
        >
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
    </div>
  );
}
