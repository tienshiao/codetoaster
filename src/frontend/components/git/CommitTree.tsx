import { useCallback, useEffect, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { RepoRoot } from "@/frontend/repo-root";
import { useGitTree, useGitFile } from "../../hooks/use-git-tree";
import { FileTree } from "../file/FileTree";
import { FileViewer, type FileViewerMemory } from "../file/FileViewer";
import { ResizeHandle } from "../v2/ResizeHandle";
import { usePaneWidth } from "../../hooks/use-pane-width";
import { getViewState, touchViewState, viewRef, type ViewRef } from "../../view-state-store";
import { useViewState } from "../../hooks/use-view-state";
import { filePathSet } from "../../utils/path-links";

interface CommitTreeProps {
  /** API identity: drives the git query endpoints, not the state slots. */
  root: RepoRoot;
  /** The `commit:<sha>` slot. */
  view: ViewRef;
  /** Full 40-char hash — resolved from commit meta so query keys are stable. */
  sha: string;
  file: string | undefined;
  onSelectFile: (path: string | null) => void;
}

/**
 * A commit's File Tree mode: browse the commit's full tree (git/tree +
 * git/file), out of the commit's own slot so it never touches the Explorer's
 * expansion set.
 *
 * The file beside the tree is drawn by `FileViewer`, the same viewer a file tab
 * uses, so it reads the same way (TASK-127) — with everything coming from this
 * commit: the content, the file list a preview's links and images resolve
 * against, the images themselves, and the symbols. A file tab opens what a
 * link or a definition names as another tab; here it is selected in the tree,
 * so the reader stays inside the commit.
 */
export function CommitTree({ root, view, sha, file, onSelectFile }: CommitTreeProps) {
  const { data: treeData, isLoading, error } = useGitTree(root, sha);
  // Expanded folders are per-commit; word wrap and the preview toggle are
  // task-wide Tree-mode preferences, so they must not be re-answered for every
  // commit opened.
  const [expandedPaths, setExpandedPaths] = useViewState("commit", view, "treeExpandedPaths");
  const prefs = viewRef(view.taskId, "prefs");
  const [lineWrap, setLineWrap] = useViewState("prefs", prefs, "treeLineWrap");
  const [preview, setPreview] = useViewState("prefs", prefs, "treePreview");
  const [target, setTarget] = useViewState("commit", view, "treeTarget");
  const treeWidth = usePaneWidth("file-tree", "left");

  const selectedFile = file ?? null;
  const {
    data: fileContent = null,
    isLoading: contentLoading,
    error: fileError,
  } = useGitFile(root, sha, selectedFile);

  // selectCommit deliberately preserves ?file= so the same file stays selected
  // across commits when it exists; this effect handles the miss. Once the tree
  // has loaded and the selected path isn't a file in it, the commit switched to
  // one where that path doesn't exist — clear the selection (dropping ?file=)
  // instead of showing the 404 pane. The fileError branch below still handles
  // genuine fetch errors on files that ARE in the tree.
  const paths = useMemo(() => (treeData ? filePathSet(treeData) : null), [treeData]);
  useEffect(() => {
    if (!paths || !selectedFile || paths.has(selectedFile)) return;
    onSelectFile(null);
  }, [paths, selectedFile, onSelectFile]);

  const memory = useMemo<FileViewerMemory>(
    () => ({
      getScrollTop: (key) => getViewState("commit", view).treeScrollTops.get(key),
      setScrollTop: (key, top) => {
        getViewState("commit", view).treeScrollTops.set(key, top);
        touchViewState(view);
      },
      getJumpedAt: () => getViewState("commit", view).treeJumpedAt,
      setJumpedAt: (seq) => {
        getViewState("commit", view).treeJumpedAt = seq;
        touchViewState(view);
      },
    }),
    [view],
  );

  // A commit's tree cannot change and is already here, so a preview's links
  // resolve against it without a fetch.
  const listFiles = useCallback(async () => paths, [paths]);

  // Where a link or a definition lands. The position rides beside the
  // selection, stamped so that asking for the same heading again is a new
  // request. A path the commit does not have is refused here rather than
  // selected: the effect above would clear it again, and the reader would see
  // the selection vanish with no word as to why.
  const openFile = (path: string, line?: number, anchor?: string) => {
    if (!paths?.has(path)) {
      toast.error("That file is not in this commit", { description: path });
      return;
    }
    setTarget({ path, ...(line ? { line } : {}), ...(anchor ? { anchor } : {}), at: Date.now() });
    onSelectFile(path);
  };

  // Picked from the tree, a file opens where it was left, not where a link
  // once sent it.
  const pickFile = (path: string) => {
    setTarget(null);
    onSelectFile(path);
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm gap-2">
        <Loader2 className="animate-spin" size={16} /> Loading tree...
      </div>
    );
  }

  if (error || !treeData) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        {error instanceof Error ? error.message : "Failed to load tree"}
      </div>
    );
  }

  const files = treeData.files;
  if (files.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        This commit has no files.
      </div>
    );
  }

  const position = target && target.path === selectedFile ? target : null;

  return (
    // `overflow-hidden` for the same reason as `DiffLayout`: the tree's floor
    // and the pane's beside it add up to more than a tab group's minimum, and
    // the spill has to be clipped rather than painted over the next group.
    <div className="flex h-full min-w-0 overflow-hidden">
      <div {...treeWidth.paneProps} className="overflow-hidden">
        <FileTree
          files={files}
          selectedFile={selectedFile}
          onSelectFile={pickFile}
          expandedPaths={expandedPaths}
          onExpandedPathsChange={setExpandedPaths}
        />
      </div>
      <ResizeHandle
        label="Resize file tree"
        onResizeStart={treeWidth.onResizeStart}
        onResize={treeWidth.onResize}
        onResizeEnd={treeWidth.onResizeEnd}
        onNudge={treeWidth.onNudge}
      />
      <div {...treeWidth.restProps} className="overflow-hidden">
        {!selectedFile ? (
          <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
            No file selected
          </div>
        ) : fileError ? (
          // Stale deep link: ?file= no longer exists at this sha (git/file 404s).
          <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
            {fileError instanceof Error ? fileError.message : "File not found in this commit"}
          </div>
        ) : (
          <FileViewer
            // One viewer per file, as a file tab is one tab per file: a symbol
            // popover or a pending link click belongs to the file it came from.
            key={selectedFile}
            root={root}
            path={selectedFile}
            sha={sha}
            content={fileContent}
            loading={contentLoading}
            lineWrap={lineWrap}
            onLineWrapChange={setLineWrap}
            preview={preview}
            onPreviewChange={setPreview}
            memory={memory}
            line={position?.line}
            anchor={position?.anchor}
            anchorAt={position?.anchor ? position.at : undefined}
            listFiles={listFiles}
            onOpenFile={openFile}
          />
        )}
      </div>
    </div>
  );
}
