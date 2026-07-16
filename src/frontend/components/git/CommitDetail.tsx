import { memo, useMemo, useState, useCallback } from "react";
import { Loader2, Copy, Check } from "lucide-react";
import { useGitCommit } from "../../hooks/use-git-commit";
import { DiffFile } from "../diff/DiffFile";
import { DiffStat, sumDiffStats } from "../diff/DiffStat";
import { relativeDate, absoluteDate } from "../../utils/relativeDate";
import type { FileDiff } from "../../types/diff";

interface CommitDetailProps {
  sessionId: string;
  sha: string | undefined;
  onSelectCommit: (sha: string) => void;
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

export function CommitDetail({ sessionId, sha, onSelectCommit }: CommitDetailProps) {
  const { data, isLoading, error } = useGitCommit(sessionId, sha);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  const toggleFile = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const files = data?.files;
  const meta = data?.meta;
  const { additions: totalAdditions, deletions: totalDeletions } = useMemo(
    () => sumDiffStats(files ?? []),
    [files],
  );
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

  return (
    <div className="h-full overflow-y-auto">
      {/* Metadata header */}
      <div className="px-4 py-3 border-b border-border space-y-2">
        {/* Mode bar — only "Commit" is functional in phase 1 */}
        <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
          <span className="px-2.5 py-1 bg-accent text-accent-foreground">Commit</span>
        </div>

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
