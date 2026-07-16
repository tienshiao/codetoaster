import { memo } from "react";
import { Loader2 } from "lucide-react";
import { relativeDate, absoluteDate } from "../../utils/relativeDate";
import type { GitLogCommit } from "../../types/git";

interface CommitListProps {
  commits: GitLogCommit[];
  selectedSha: string | undefined;
  onSelect: (sha: string) => void;
  hasMore: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
}

// A commit row matches the selected SHA when either equals the other's prefix
// (the URL may carry a short SHA while log rows are full 40-char hashes).
function shaMatches(rowSha: string, selected: string | undefined): boolean {
  if (!selected) return false;
  return rowSha === selected || rowSha.startsWith(selected) || selected.startsWith(rowSha);
}

// Memoized so a selection change re-renders only the two rows whose isSelected
// flips, not the whole list. `onSelect` is stable (from the parent's useCallback)
// and absoluteDate is computed here so it runs once per commit, not per render.
const CommitRow = memo(function CommitRow({
  commit,
  isSelected,
  onSelect,
}: {
  commit: GitLogCommit;
  isSelected: boolean;
  onSelect: (sha: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(commit.hash)}
      className={`w-full flex items-center gap-3 px-3 py-1.5 text-left text-xs border-b border-border/50 ${
        isSelected ? "bg-accent text-accent-foreground" : "hover:bg-accent/40 text-foreground/90"
      }`}
    >
      <span className="flex-1 min-w-0 flex items-center gap-2">
        <span className="truncate">{commit.subject}</span>
        {commit.refs.map((ref) => (
          <span
            key={ref}
            className="shrink-0 px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 text-[10px] font-medium"
          >
            {ref}
          </span>
        ))}
      </span>
      <span className="shrink-0 text-muted-foreground truncate max-w-[120px]">{commit.author}</span>
      <span
        className="shrink-0 text-muted-foreground/70 w-16 text-right"
        title={absoluteDate(commit.date)}
      >
        {relativeDate(commit.date)}
      </span>
      <span className="shrink-0 font-mono text-muted-foreground/60 w-16">
        {commit.hash.slice(0, 8)}
      </span>
    </button>
  );
});

export function CommitList({
  commits,
  selectedSha,
  onSelect,
  hasMore,
  isFetchingNextPage,
  onLoadMore,
}: CommitListProps) {
  return (
    <div className="h-full overflow-y-auto">
      {commits.map((commit) => (
        <CommitRow
          key={commit.hash}
          commit={commit}
          isSelected={shaMatches(commit.hash, selectedSha)}
          onSelect={onSelect}
        />
      ))}

      {hasMore && (
        <div className="p-2 flex justify-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isFetchingNextPage}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md border border-border hover:bg-accent/40 disabled:opacity-50"
          >
            {isFetchingNextPage && <Loader2 size={12} className="animate-spin" />}
            {isFetchingNextPage ? "Loading..." : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
