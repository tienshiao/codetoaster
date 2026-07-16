import { memo, useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Loader2 } from "lucide-react";
import { relativeDate, absoluteDate } from "../../utils/relativeDate";
import { assignLanes, type GraphRow, type GraphState } from "../../utils/commitGraph";
import { CommitGraph } from "./CommitGraph";
import type { GitLogCommit, GitRefsResponse } from "../../types/git";

// Fixed row height (px) so virtualization measures exactly and graph cells /
// text columns line up. Must match the h-7 on each row.
const ROW_HEIGHT = 28;

interface CommitListProps {
  commits: GitLogCommit[];
  selectedSha: string | undefined;
  onSelect: (sha: string) => void;
  hasMore: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  refsData: GitRefsResponse | undefined;
}

// A commit row matches the selected SHA when either equals the other's prefix
// (the URL may carry a short SHA while log rows are full 40-char hashes).
function shaMatches(rowSha: string, selected: string | undefined): boolean {
  if (!selected) return false;
  return rowSha === selected || rowSha.startsWith(selected) || selected.startsWith(rowSha);
}

type RefKind = "head" | "branch" | "remote" | "tag" | "unknown";

interface RefSets {
  branches: Set<string>;
  remotes: Set<string>;
  tags: Set<string>;
  headBranch: string | null;
}

function classifyRef(name: string, sets: RefSets): RefKind {
  if (sets.branches.has(name)) return name === sets.headBranch ? "head" : "branch";
  if (sets.remotes.has(name)) return "remote";
  if (sets.tags.has(name)) return "tag";
  return "unknown";
}

const REF_VARIANT: Record<RefKind, string> = {
  head: "bg-primary text-primary-foreground font-semibold",
  branch: "bg-primary/15 text-primary",
  remote: "bg-muted text-muted-foreground",
  tag: "bg-amber-500/15 text-amber-500",
  unknown: "bg-muted text-muted-foreground",
};

// Memoized so a selection change re-renders only the two rows whose isSelected
// flips, not the whole list. `onSelect`, `refSets`, `row` and `globalLanes` are
// referentially stable per commits array, so isSelected is the only prop that
// changes for most rows.
const CommitRow = memo(function CommitRow({
  commit,
  isSelected,
  onSelect,
  row,
  globalLanes,
  refSets,
}: {
  commit: GitLogCommit;
  isSelected: boolean;
  onSelect: (sha: string) => void;
  row: GraphRow;
  globalLanes: number;
  refSets: RefSets;
}) {
  // Drop the literal "HEAD" pseudo-ref; the current branch is styled instead.
  const refs = commit.refs.filter((r) => r !== "HEAD");
  const shown = refs.slice(0, 3);
  const overflow = refs.length - shown.length;

  return (
    <button
      type="button"
      onClick={() => onSelect(commit.hash)}
      className={`w-full h-7 flex items-center gap-2 px-2 text-left text-xs border-b border-border/50 ${
        isSelected ? "bg-accent text-accent-foreground" : "hover:bg-accent/40 text-foreground/90"
      }`}
    >
      <CommitGraph row={row} height={ROW_HEIGHT} globalLanes={globalLanes} />
      <span className="flex-1 min-w-0 flex items-center gap-2">
        {shown.map((ref) => (
          <span
            key={ref}
            className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium max-w-[140px] truncate ${
              REF_VARIANT[classifyRef(ref, refSets)]
            }`}
            title={ref}
          >
            {ref}
          </span>
        ))}
        {overflow > 0 && (
          <span className="shrink-0 text-[10px] text-muted-foreground">+{overflow}</span>
        )}
        <span className="truncate">{commit.subject}</span>
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
  refsData,
}: CommitListProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  // Incremental lane assignment. Pagination only ever appends: react-query
  // keeps earlier pages (and their commit objects) by reference, so if the
  // first and last previously-processed commits are identity-equal, the prefix
  // is intact and only the appended tail needs lane assignment — continuing
  // from the saved GraphState (O(tail) per append instead of O(total), and
  // existing GraphRow identities survive so memoized rows don't re-render).
  // Any prefix change (409 reset, refetch) falls back to a full recompute.
  const graphCache = useRef<{
    commits: GitLogCommit[];
    rows: GraphRow[];
    state: GraphState;
    maxLanes: number;
  } | null>(null);
  const { rows, globalLanes } = useMemo(() => {
    const cache = graphCache.current;
    const prev = cache?.commits.length ?? 0;
    let next: NonNullable<typeof cache>;
    if (
      cache &&
      prev > 0 &&
      commits.length >= prev &&
      commits[0] === cache.commits[0] &&
      commits[prev - 1] === cache.commits[prev - 1]
    ) {
      const tail = assignLanes(commits.slice(prev), cache.state);
      next = {
        commits,
        rows: prev === commits.length ? cache.rows : [...cache.rows, ...tail.rows],
        state: tail.state,
        maxLanes: tail.rows.reduce((max, r) => Math.max(max, r.laneCount), cache.maxLanes),
      };
    } else {
      const full = assignLanes(commits);
      next = {
        commits,
        rows: full.rows,
        state: full.state,
        maxLanes: full.rows.reduce((max, r) => Math.max(max, r.laneCount), 1),
      };
    }
    graphCache.current = next;
    return { rows: next.rows, globalLanes: next.maxLanes };
  }, [commits]);

  const refSets = useMemo<RefSets>(
    () => ({
      branches: new Set(refsData?.branches.map((b) => b.name) ?? []),
      remotes: new Set(refsData?.remotes.map((r) => r.name) ?? []),
      tags: new Set(refsData?.tags.map((t) => t.name) ?? []),
      headBranch: refsData?.head.ref ?? null,
    }),
    [refsData],
  );

  // One extra virtual row for the bottom sentinel (spinner / Load more) when
  // more history remains.
  const count = commits.length + (hasMore ? 1 : 0);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  const virtualItems = virtualizer.getVirtualItems();

  // Auto-paginate when the last rendered row nears the end of loaded history.
  useEffect(() => {
    const last = virtualItems[virtualItems.length - 1];
    if (!last) return;
    if (last.index >= commits.length - 10 && hasMore && !isFetchingNextPage) {
      onLoadMore();
    }
  }, [virtualItems, commits.length, hasMore, isFetchingNextPage, onLoadMore]);

  // Scroll the selected commit into view — once per selection. The effect
  // re-runs on page appends (commits identity changes), but the ref guard
  // keeps it from re-scrolling and yanking the viewport away from wherever
  // the user scrolled; it only fires again when selectedSha itself changes,
  // or when a not-yet-loaded selection (deep link) finally appears in a page.
  const scrolledToSha = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedSha) return;
    if (scrolledToSha.current === selectedSha) return;
    const idx = commits.findIndex((c) => shaMatches(c.hash, selectedSha));
    if (idx >= 0) {
      virtualizer.scrollToIndex(idx, { align: "auto" });
      scrolledToSha.current = selectedSha;
    }
    // virtualizer identity is stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSha, commits]);

  return (
    <div ref={parentRef} className="h-full overflow-y-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
        {virtualItems.map((vi) => {
          const isSentinel = vi.index >= commits.length;
          return (
            <div
              key={vi.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: vi.size,
                transform: `translateY(${vi.start}px)`,
              }}
            >
              {isSentinel ? (
                // Auto-pagination fires whenever this row nears the viewport,
                // so a manual "Load more" control would never be reachable —
                // the sentinel only signals fetch progress.
                <div className="h-full flex items-center justify-center">
                  {isFetchingNextPage && (
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 size={12} className="animate-spin" /> Loading...
                    </span>
                  )}
                </div>
              ) : (
                <CommitRow
                  commit={commits[vi.index]!}
                  isSelected={shaMatches(commits[vi.index]!.hash, selectedSha)}
                  onSelect={onSelect}
                  row={rows[vi.index]!}
                  globalLanes={globalLanes}
                  refSets={refSets}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
