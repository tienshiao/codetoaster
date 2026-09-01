import { memo, useMemo, useState, useCallback, useEffect } from "react";
import { Loader2, Copy, Check, WrapText } from "lucide-react";
import { useGitCommit } from "../../hooks/use-git-commit";
import { useGitTree, useGitFile } from "../../hooks/use-git-tree";
import { DiffFile } from "../diff/DiffFile";
import { DiffLayout, type DiffLayoutScroll } from "../diff/DiffLayout";
import { DiffStat, sumDiffStats } from "../diff/DiffStat";
import { FileTree } from "../file/FileTree";
import { FileContent } from "../file/FileContent";
import { Button } from "../ui/button";
import { ResizeHandle } from "../v2/ResizeHandle";
import { usePaneWidth } from "../../hooks/use-pane-width";
import { relativeDate, absoluteDate } from "../../utils/relativeDate";
import { toggleInSet, getViewState, setViewField, viewRef, type ViewRef } from "../../view-state-store";
import { useViewState } from "../../hooks/use-view-state";
import { RefChip, displayRefs, type RefSets } from "./RefChip";
import type { FileDiff } from "../../types/diff";
import type { GitCommitMeta, GitViewMode } from "../../types/git";

interface CommitDetailProps {
  /** API identity: drives the git query endpoints, not the state slots. */
  taskId: string;
  /** The `commit:<sha>` slot this detail's state lives in. */
  view: ViewRef;
  sha: string | undefined;
  mode: GitViewMode;
  onSelectMode: (mode: GitViewMode) => void;
  onSelectCommit: (sha: string) => void;
  file: string | undefined;
  onSelectFile: (path: string | null) => void;
  refSets: RefSets;
}

// Memoized so toggling one file's expansion re-renders only that row. Props are
// stable: `file`/`taskId`/`imageRefs` are referentially stable per commit and
// `onToggle` is a stable callback taking the path, so `isExpanded` is the only
// prop that changes — and only for the toggled row.
const CommitFileRow = memo(function CommitFileRow({
  file,
  isExpanded,
  onToggle,
  taskId,
  imageRefs,
}: {
  file: FileDiff;
  isExpanded: boolean;
  onToggle: (path: string) => void;
  taskId: string;
  imageRefs: { old: string; new: string };
}) {
  const handleToggle = useCallback(() => onToggle(file.newPath), [onToggle, file.newPath]);
  return (
    <DiffFile
      file={file}
      isExpanded={isExpanded}
      onToggle={handleToggle}
      taskId={taskId}
      imageRefs={imageRefs}
    />
  );
});

function CopyHash({ hash }: { hash: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
      onClick={() => {
        navigator.clipboard.writeText(hash);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      title="Copy full hash"
    >
      {hash}
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

const MODES: { key: GitViewMode; label: string }[] = [
  { key: "commit", label: "Commit" },
  { key: "changes", label: "Changes" },
  { key: "tree", label: "File Tree" },
];

function ModeBar({ mode, onSelectMode }: { mode: GitViewMode; onSelectMode: (mode: GitViewMode) => void }) {
  return (
    <div className="shrink-0 px-4 py-2 border-b border-border">
      <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
        {MODES.map((m, i) => (
          <button
            key={m.key}
            className={`px-2.5 py-1 transition-colors ${i > 0 ? "border-l border-border" : ""} ${
              mode === m.key
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
            }`}
            onClick={() => onSelectMode(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// Commit mode: scrollable metadata header + per-file expanding diff list.
function CommitMode({
  meta,
  files,
  taskId,
  view,
  imageRefs,
  onSelectCommit,
  refSets,
}: {
  meta: GitCommitMeta;
  files: FileDiff[];
  taskId: string;
  view: ViewRef;
  imageRefs: { old: string; new: string };
  onSelectCommit: (sha: string) => void;
  refSets: RefSets;
}) {
  // Expansion state persists across tab switches. The hook binds the slot at
  // mount, and CommitMode is keyed by meta.hash, so a commit switch remounts
  // and rebinds rather than writing the previous commit's slot.
  const [expandedPaths, setExpandedPaths] = useViewState("commit", view, "commitExpandedPaths");
  const toggleFile = useCallback((path: string) => {
    setExpandedPaths((prev) => toggleInSet(prev, path));
  }, [setExpandedPaths]);

  const { additions: totalAdditions, deletions: totalDeletions } = useMemo(
    () => sumDiffStats(files),
    [files],
  );

  return (
    <div className="h-full overflow-y-auto">
      {/* Metadata header */}
      <div className="px-4 py-3 border-b border-border space-y-2">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground">{meta.author}</span>
          <span className="text-xs text-muted-foreground">{meta.email}</span>
          <span className="text-xs text-muted-foreground/70" title={absoluteDate(meta.authoredAt)}>
            {relativeDate(meta.authoredAt)} · {absoluteDate(meta.authoredAt)}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap text-xs">
          <CopyHash hash={meta.hash} />
          {meta.parents.length > 0 && (
            <span className="flex items-center gap-1 text-muted-foreground">
              {meta.parents.length > 1 ? "parents:" : "parent:"}
              {meta.parents.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="font-mono text-blue-400 hover:underline"
                  onClick={() => onSelectCommit(p)}
                >
                  {p.slice(0, 8)}
                </button>
              ))}
            </span>
          )}
          {displayRefs(meta.refs, refSets).map((ref) => (
            <RefChip key={ref} name={ref} refSets={refSets} />
          ))}
        </div>

        {meta.message && (
          <pre className="text-xs text-foreground/90 whitespace-pre-wrap font-sans leading-relaxed">
            {meta.message.trimEnd()}
          </pre>
        )}
      </div>

      {/* File list */}
      <div className="px-2 py-1 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {files.length} file{files.length !== 1 ? "s" : ""} changed
        </span>
        <span className="flex items-center gap-1.5">
          <DiffStat additions={totalAdditions} deletions={totalDeletions} />
        </span>
      </div>

      <div className="px-2 pb-4 flex flex-col gap-2">
        {files.length === 0 ? (
          <div className="px-2 py-4 text-xs text-muted-foreground italic">
            No file changes in this commit.
          </div>
        ) : (
          files.map((file) => (
            <CommitFileRow
              key={file.newPath}
              file={file}
              isExpanded={expandedPaths.has(file.newPath)}
              onToggle={toggleFile}
              taskId={taskId}
              imageRefs={imageRefs}
            />
          ))
        )}
      </div>
    </div>
  );
}

// Changes mode: the shared diff layout with no comments / context / symbols.
// State is backed by the commit's own slot, so it survives tab switches yet
// never touches the diff tab's — the instance is keyed by the full hash
// upstream, so the mount-time bind is always for the commit on screen.
function ChangesMode({
  taskId,
  view,
  files,
  imageRefs,
}: {
  taskId: string;
  view: ViewRef;
  files: FileDiff[];
  imageRefs: { old: string; new: string };
}) {
  const [selectedFile, setSelectedFile] = useViewState("commit", view, "changesSelectedFile");
  const [collapsedFiles, setCollapsedFiles] = useViewState("commit", view, "changesCollapsedFiles");
  const [viewModeOverride, setViewModeOverride] = useViewState("commit", view, "changesViewModeOverride");
  const [treeCollapsedPaths, setTreeCollapsedPaths] = useViewState("commit", view, "changesTreeCollapsedPaths");

  // Stable scroll persistence handle for the layout's restore/persist/reseed,
  // backed by the same slot.
  const scroll = useMemo<DiffLayoutScroll>(
    () => ({
      getStored: () => getViewState("commit", view).changesScrollTop,
      setStored: (top) => setViewField("commit", view, "changesScrollTop", top),
    }),
    [view],
  );

  return (
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
      imageRefs={imageRefs}
    />
  );
}

// Tree mode: browse the commit's full tree (git/tree + git/file), mirroring the
// file view's layout, out of the commit's own slot so it never touches the file
// view's expansion set.
function TreeMode({
  taskId,
  view,
  sha,
  file,
  onSelectFile,
}: {
  taskId: string;
  view: ViewRef;
  // Full 40-char hash — resolved from commit meta so query keys are stable.
  sha: string;
  file: string | undefined;
  onSelectFile: (path: string | null) => void;
}) {
  const { data: treeData, isLoading, error } = useGitTree(taskId, sha);
  // Expanded folders are per-commit; word wrap is a task-wide Tree-mode
  // preference, so it must not be re-answered for every commit opened.
  const [expandedPaths, setExpandedPaths] = useViewState("commit", view, "treeExpandedPaths");
  const [lineWrap, setLineWrap] = useViewState("prefs", viewRef(view.taskId, "prefs"), "treeLineWrap");
  const treeWidth = usePaneWidth("file-tree", "left");

  const selectedFile = file ?? null;
  const {
    data: fileContent = null,
    isLoading: contentLoading,
    error: fileError,
  } = useGitFile(taskId, sha, selectedFile);

  // selectCommit deliberately preserves ?file= so the same file stays selected
  // across commits when it exists; this effect handles the miss. Once the tree
  // has loaded and the selected path isn't a file in it, the commit switched to
  // one where that path doesn't exist — clear the selection (dropping ?file=)
  // instead of showing the 404 pane. The fileError branch below still handles
  // genuine fetch errors on files that ARE in the tree.
  useEffect(() => {
    if (!treeData || !selectedFile) return;
    if (treeData.files.some((f) => !f.isDirectory && f.path === selectedFile)) return;
    onSelectFile(null);
  }, [treeData, selectedFile, onSelectFile]);

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

  const imageUrl = selectedFile
    ? `/api/tasks/${taskId}/image/git?ref=${sha}&file=${encodeURIComponent(selectedFile)}`
    : undefined;

  return (
    // `overflow-hidden` for the same reason as `DiffLayout`: the tree's floor
    // and the pane's beside it add up to more than a tab group's minimum, and
    // the spill has to be clipped rather than painted over the next group.
    <div className="flex h-full min-w-0 overflow-hidden">
      <div {...treeWidth.paneProps} className="overflow-hidden">
        <FileTree
          files={files}
          selectedFile={selectedFile}
          onSelectFile={onSelectFile}
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
      <div {...treeWidth.restProps} className="flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-mono text-foreground">{selectedFile || "No file selected"}</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant={lineWrap ? "secondary" : "ghost"}
              size="sm"
              className="h-6 w-6 p-0"
              title="Wrap"
              onClick={() => setLineWrap(!lineWrap)}
            >
              <WrapText size={14} />
            </Button>
          </div>
        </div>
        {fileError && selectedFile ? (
          // Stale deep link: ?file= no longer exists at this sha (git/file 404s).
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            {fileError instanceof Error ? fileError.message : "File not found in this commit"}
          </div>
        ) : (
          <FileContent
            key={selectedFile || ""}
            filePath={selectedFile || ""}
            taskId={taskId}
            content={fileContent}
            loading={contentLoading}
            lineWrap={lineWrap}
            imageUrl={imageUrl}
          />
        )}
      </div>
    </div>
  );
}

export function CommitDetail({ taskId, view, sha, mode, onSelectMode, onSelectCommit, file, onSelectFile, refSets }: CommitDetailProps) {
  // Tree mode renders no diff, so skip the token fetch until a diff-rendering
  // mode needs it.
  const { data, isLoading, error } = useGitCommit(taskId, sha, mode !== "tree");

  const meta = data?.meta;
  const files = data?.files;
  // Both image sides come from this commit: old = first parent (absent for a
  // root commit, where images are "added" so the old side isn't rendered),
  // new = the commit itself.
  const imageRefs = useMemo(
    () => ({ old: meta?.parents[0] ?? "", new: meta?.hash ?? "" }),
    [meta?.parents, meta?.hash],
  );

  if (!sha) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        Select a commit
      </div>
    );
  }

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="h-full flex items-center justify-center text-muted-foreground text-sm gap-2">
          <Loader2 className="animate-spin" size={16} /> Loading commit...
        </div>
      );
    }

    if (error || !data || !meta || !files) {
      return (
        <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
          {error instanceof Error ? error.message : "Failed to load commit"}
        </div>
      );
    }

    // Tree/file reads use the resolved full 40-char hash so query keys are stable
    // (the URL sha may be abbreviated). `key={meta.hash}` resets local tree state
    // per commit.
    if (mode === "tree") {
      return (
        <TreeMode
          key={meta.hash}
          taskId={taskId}
          view={view}
          sha={meta.hash}
          file={file}
          onSelectFile={onSelectFile}
        />
      );
    }

    if (mode === "changes") {
      return (
        <ChangesMode key={meta.hash} taskId={taskId} view={view} files={files} imageRefs={imageRefs} />
      );
    }

    return (
      <CommitMode
        key={meta.hash}
        meta={meta}
        files={files}
        taskId={taskId}
        view={view}
        imageRefs={imageRefs}
        onSelectCommit={onSelectCommit}
        refSets={refSets}
      />
    );
  };

  return (
    <div className="h-full flex flex-col">
      <ModeBar mode={mode} onSelectMode={onSelectMode} />
      <div className="flex-1 min-h-0">{renderContent()}</div>
    </div>
  );
}
