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
import { ResizeHandle } from "../v2/ResizeHandle";
import { usePaneWidth } from "../../hooks/use-pane-width";
import { FileTree } from "./FileTree";
import { DiffFile } from "./DiffFile";
import { sumDiffStats } from "./DiffStat";
import { Button } from "../ui/button";
import { collectPathPrefixes, pruneSet, toggleInSet, withoutAll } from "../../view-state-store";
import { symbolAtPoint } from "../../utils/symbolClick";
import type { FileDiff, DiffHunk, HunkExpansionState } from "../../types/diff";
import type { UseCommentsReturn } from "../../hooks/use-comments";
import "./DiffView.css";

const FILE_COUNT_THRESHOLD = 30;
const TOTAL_LINES_THRESHOLD = 1500;

// Which mounted `DiffLayout` the single-file arrow keys belong to.
//
// The listener has to be on `window`: nothing inside a diff pane is focusable,
// so arrowing between files must work without the user having clicked a row
// first. That was harmless while a route mounted exactly one of these, but
// `TabArea` renders every group's active pane at once — so a split showing the
// working-tree diff beside a commit's changes had one ArrowRight advance the
// file in *both*, each writing a new selection and a reset scroll offset into
// its own slot. The panes take turns instead: the last one pointed at owns the
// keys, and a lone pane owns them without being asked.
//
// Only a pane in single-file mode ever enters the set, because only that pane
// installs a listener. An "all"-mode pane holding the claim would be ownership
// no key press could ever reach — and the check below would turn the arrows off
// in the pane that *was* listening.
const mountedDiffLayouts = new Set<symbol>();
let diffKeyboardOwner: symbol | null = null;

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
  taskId?: string;

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

  // Chrome for choosing *which* file is shown. Both default on; a per-file diff
  // tab turns them off, because a tree of one row and an All/Single toggle over
  // one file are controls with nothing to control — the tab already is the file.
  showFileTree?: boolean;
  showViewModeToggle?: boolean;

  symbol?: DiffLayoutSymbol;
}

// The comment-free presentation + navigation core shared by the working-tree
// diff view and the git commit "Changes" view: FileTree sidebar, All/Single
// toggle, scrollable DiffFile list, active-file tracking, and single-file nav.
// All persistence-backed state is injected so each consumer owns its own store.
export function DiffLayout({
  files,
  taskId,
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
  showFileTree = true,
  showViewModeToggle = true,
  symbol,
}: DiffLayoutProps) {
  const diffContainerRef = useRef<HTMLDivElement>(null);
  const fileRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const treeWidth = usePaneWidth("file-tree", "left");

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
    onCollapsedFilesChange((prev) => withoutAll(prev, [path]));
  }, [onCollapsedFilesChange]);

  const navigateToFile = useCallback((path: string) => {
    onSelectedFileChange(path);
    expandFile(path);
    // Reveal the target in the tree: prev/next/keyboard can land on a file
    // whose directory is collapsed. Only explicit navigation does this —
    // passive selection (scroll tracking, mount restore) must not un-collapse
    // directories the user closed.
    onTreeCollapsedPathsChange((prev) => withoutAll(prev, collectPathPrefixes([path])));
    if (viewMode === "all") {
      const el = fileRefs.current.get(path);
      if (el) {
        el.scrollIntoView({ behavior: "instant", block: "start" });
      }
    } else {
      diffContainerRef.current?.scrollTo({ top: 0 });
    }
  }, [viewMode, onSelectedFileChange, expandFile, onTreeCollapsedPathsChange]);

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

  // This pane's claim on the arrow keys. A ref rather than a memo, because a
  // memo React is free to discard would hand the same pane a new identity and
  // orphan whatever it had claimed.
  const layoutIdRef = useRef<symbol | null>(null);
  layoutIdRef.current ??= Symbol("diff-layout");
  const layoutId = layoutIdRef.current;

  // Registration is gated on `single` for the same reason the listener below is:
  // a pane in "all" mode has no use for the arrow keys, and a claim it never
  // acts on is worse than no claim — the ownership check in the listener makes
  // the *other* pane's arrows a silent no-op, with nothing on screen to say why.
  // A claim only exists while a listener does.
  //
  // Kept apart from the listener rather than folded into it because the
  // listener's dependencies change on every navigation: re-running this with
  // them would release the keys to whatever else is mounted and then fail to
  // reclaim them, so a split would steal the arrows from itself on first use.
  useEffect(() => {
    if (viewMode !== "single") return;
    mountedDiffLayouts.add(layoutId);
    diffKeyboardOwner ??= layoutId;
    return () => {
      mountedDiffLayouts.delete(layoutId);
      // Hand the keys to whatever is still listening, so closing the owning tab
      // does not leave the remaining pane unable to arrow anywhere.
      if (diffKeyboardOwner === layoutId) {
        diffKeyboardOwner = mountedDiffLayouts.values().next().value ?? null;
      }
    };
  }, [viewMode, layoutId]);

  // Keyboard navigation in single-file mode
  useEffect(() => {
    if (viewMode !== "single") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (diffKeyboardOwner !== layoutId) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft") {
        navigateToPrevFile();
      } else if (e.key === "ArrowRight") {
        navigateToNextFile();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [viewMode, navigateToPrevFile, navigateToNextFile, layoutId]);

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
    onCollapsedFilesChange((prev) => toggleInSet(prev, path));
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
            taskId={taskId}
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
          taskId={taskId}
          imageRefs={imageRefs}
        />
      </div>
    ));
  };

  const symbolClasses = symbol ? `symbol-clickable ${symbol.modHeld ? "mod-held" : ""}` : "";

  return (
    // Capture, so a click anywhere in the pane claims the arrow keys before any
    // handler inside it can stop the event — but only from a pane that is
    // listening: pointing at an "all"-mode pane, where the arrows do nothing,
    // must not take them away from the single-file pane beside it.
    // `overflow-hidden`, because with a tree the row's two floors add up to
    // more than a tab group's own minimum (160px): a diff dragged that narrow
    // would otherwise paint over the group beside it rather than be clipped.
    <div
      className="flex h-full min-w-0 overflow-hidden"
      onPointerDownCapture={() => {
        if (viewMode === "single") diffKeyboardOwner = layoutId;
      }}
    >
      {/* File tree sidebar */}
      {showFileTree && (
        <>
          <div {...treeWidth.paneProps} className="overflow-hidden">
            <FileTree
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
          <ResizeHandle
            label="Resize file tree"
            onResizeStart={treeWidth.onResizeStart}
            onResize={treeWidth.onResize}
            onResizeEnd={treeWidth.onResizeEnd}
            onNudge={treeWidth.onNudge}
          />
        </>
      )}

      {/* Diff content. The floor that keeps room beside the tree is the tree's
          to impose, so it is only worn while there is a tree: a diff pane in a
          narrow tab group can be 160px (`MIN_GROUP_PX`) wide, and a 240px
          minimum on its only child would push the overflow out of the row. */}
      <div
        {...(showFileTree ? treeWidth.restProps : {})}
        className={`flex flex-col overflow-hidden${showFileTree ? "" : " min-w-0 flex-1"}`}
      >
        {/* View mode toggle + toolbar extras. Skipped entirely when neither is
            present, so a bare pane does not carry an empty band. */}
        {(showViewModeToggle || toolbarExtra) && (
          <div className="flex items-center text-xs px-4 py-2 shrink-0">
            {showViewModeToggle && (
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
                    // Seeding a selection is explicit navigation — reveal it in
                    // the tree so the highlighted row isn't hidden in a collapsed
                    // directory.
                    if (!selectedFile && files[0]) {
                      navigateToFile(files[0].newPath);
                    }
                  }}
                >
                  Single File
                </button>
              </div>
            )}
            {toolbarExtra}
          </div>
        )}

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

          {/* Floating prev/next navigation for single-file mode. Nothing to
              page through when the diff is one file — a per-file tab always is
              — so the bar would be two dead buttons over "1 of 1". */}
          {viewMode === "single" && files.length > 1 && (
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
