import { memo, useMemo, useState, useCallback, useEffect } from "react";
import { Loader2, Copy, Check, WrapText } from "lucide-react";
import { useGitCommit } from "../../hooks/use-git-commit";
import { useGitTree, useGitFile } from "../../hooks/use-git-tree";
import { DiffFile } from "../diff/DiffFile";
import { DiffLayout } from "../diff/DiffLayout";
import { DiffStat, sumDiffStats } from "../diff/DiffStat";
import { FileTree } from "../file/FileTree";
import { FileContent } from "../file/FileContent";
import { Button } from "../ui/button";
import { relativeDate, absoluteDate } from "../../utils/relativeDate";
import type { FileDiff } from "../../types/diff";
import type { GitCommitMeta, GitViewMode } from "../../types/git";

interface CommitDetailProps {
  sessionId: string;
  sha: string | undefined;
  mode: GitViewMode;
  onSelectMode: (mode: GitViewMode) => void;
  onSelectCommit: (sha: string) => void;
  file: string | undefined;
  onSelectFile: (path: string | null) => void;
}

// Memoized so toggling one file's expansion re-renders only that row. Props are
// stable: `file`/`sessionId`/`imageRefs` are referentially stable per commit and
// `onToggle` is a stable callback taking the path, so `isExpanded` is the only
// prop that changes — and only for the toggled row.
const CommitFileRow = memo(function CommitFileRow({
  file,
  isExpanded,
  onToggle,
  sessionId,
  imageRefs,
}: {
  file: FileDiff;
  isExpanded: boolean;
  onToggle: (path: string) => void;
  sessionId: string;
  imageRefs: { old: string; new: string };
}) {
  const handleToggle = useCallback(() => onToggle(file.newPath), [onToggle, file.newPath]);
  return (
    <DiffFile
      file={file}
      isExpanded={isExpanded}
      onToggle={handleToggle}
      sessionId={sessionId}
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
  sessionId,
  imageRefs,
  onSelectCommit,
}: {
  meta: GitCommitMeta;
  files: FileDiff[];
  sessionId: string;
  imageRefs: { old: string; new: string };
  onSelectCommit: (sha: string) => void;
}) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const toggleFile = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

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
          {meta.refs.map((ref) => (
            <span
              key={ref}
              className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 text-[10px] font-medium"
            >
              {ref}
            </span>
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
              sessionId={sessionId}
              imageRefs={imageRefs}
            />
          ))
        )}
      </div>
    </div>
  );
}

// Changes mode: the shared diff layout with no comments / context / symbols.
// All persisted state is plain local state so a commit's file list never touches
// the diff tab's view-state store; a `key={sha}` on the instance resets it.
function ChangesMode({
  sessionId,
  files,
  imageRefs,
}: {
  sessionId: string;
  files: FileDiff[];
  imageRefs: { old: string; new: string };
}) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [viewModeOverride, setViewModeOverride] = useState<"all" | "single" | null>(null);
  const [treeCollapsedPaths, setTreeCollapsedPaths] = useState<Set<string>>(new Set());

  return (
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
      imageRefs={imageRefs}
    />
  );
}

// Tree mode: browse the commit's full tree (git/tree + git/file), mirroring the
// file tab's layout. All state is plain local state (`key={sha}` resets it per
// commit) so it never touches the file tab's fileView view-state.
function TreeMode({
  sessionId,
  sha,
  file,
  onSelectFile,
}: {
  sessionId: string;
  // Full 40-char hash — resolved from commit meta so query keys are stable.
  sha: string;
  file: string | undefined;
  onSelectFile: (path: string | null) => void;
}) {
  const { data: treeData, isLoading, error } = useGitTree(sessionId, sha);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [lineWrap, setLineWrap] = useState(false);

  const selectedFile = file ?? null;
  const {
    data: fileContent = null,
    isLoading: contentLoading,
    error: fileError,
  } = useGitFile(sessionId, sha, selectedFile);

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
    ? `/api/sessions/${sessionId}/image/git?ref=${sha}&file=${encodeURIComponent(selectedFile)}`
    : undefined;

  return (
    <div className="flex h-full">
      <div className="w-[280px] shrink-0">
        <FileTree
          sessionId={sessionId}
          files={files}
          selectedFile={selectedFile}
          onSelectFile={onSelectFile}
          expandedPaths={expandedPaths}
          onExpandedPathsChange={setExpandedPaths}
        />
      </div>
      <div className="flex-1 flex flex-col overflow-hidden">
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
            sessionId={sessionId}
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

export function CommitDetail({ sessionId, sha, mode, onSelectMode, onSelectCommit, file, onSelectFile }: CommitDetailProps) {
  // Tree mode renders no diff, so skip the token fetch until a diff-rendering
  // mode needs it.
  const { data, isLoading, error } = useGitCommit(sessionId, sha, mode !== "tree");

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
          sessionId={sessionId}
          sha={meta.hash}
          file={file}
          onSelectFile={onSelectFile}
        />
      );
    }

    if (mode === "changes") {
      return <ChangesMode key={sha} sessionId={sessionId} files={files} imageRefs={imageRefs} />;
    }

    return (
      <CommitMode
        meta={meta}
        files={files}
        sessionId={sessionId}
        imageRefs={imageRefs}
        onSelectCommit={onSelectCommit}
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
