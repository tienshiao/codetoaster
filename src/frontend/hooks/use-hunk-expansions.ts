import { useCallback, useEffect, useRef } from "react";
import { useViewState } from "./use-view-state";
import { getViewState, pruneMap, type ViewRef } from "../view-state-store";
import { applySyntaxToLine } from "../utils/wordDiff";
import { getLanguageFromPath } from "../utils/languageDetection";
import type { DiffHunk, DiffLine, FileDiff, HunkExpansionState } from "../types/diff";
import type { LineTokens } from "../../types/highlight";

const CONTEXT_LINES = 20;

/** A hunk with nothing loaded around it yet. */
const noExpansion = (): HunkExpansionState => ({
  beforeLines: [],
  afterLines: [],
  canExpandBefore: true,
  canExpandAfter: true,
});

export interface HunkExpansions {
  hunkExpansions: Map<string, HunkExpansionState>;
  expandContext: (
    filePath: string,
    hunkIndex: number,
    direction: "before" | "after",
    hunk: DiffHunk,
    prevHunk: DiffHunk | null,
    nextHunk: DiffHunk | null,
  ) => Promise<void>;
}

/**
 * Expanded context lines for a diff, loaded on demand and kept in the view's
 * slot.
 *
 * Shared by the two diff tabs rather than owned by one of them: the whole
 * working tree (`diffAll`) and a single file of it (`diffFile`) expand context
 * identically, and the only thing that differs is which slot the loaded lines
 * land in. `files` is the diff the expansions must stay true to — the *whole*
 * diff, even for a single-file tab, since an expansion's key carries its path.
 */
export function useHunkExpansions(
  taskId: string,
  kind: "diffAll" | "diffFile",
  view: ViewRef,
  files: FileDiff[] | undefined,
): HunkExpansions {
  const [hunkExpansions, setHunkExpansions] = useViewState(kind, view, "hunkExpansions");
  /** The range each in-flight request has claimed, keyed
   * `${filePath}:${hunkIndex}:${direction}` — see `expandContext`. */
  const inFlight = useRef<Map<string, { startLine: number; endLine: number }>>(new Map());
  // The diff as of the latest render. `expandContext` is handed the hunk as it
  // stood when the chevron was clicked; by the time the response lands the diff
  // may have been refetched under it, and only the live one can say so.
  const filesRef = useRef(files);
  filesRef.current = files;
  // The slot, destructured for the same reason `useViewState` destructures it:
  // a caller passing an inline `viewRef(...)` must not rebuild `expandContext`
  // every render.
  const { taskId: slotTask, key: slotKey } = view;

  // Drop loaded context expansions that no longer line up with the diff. Keys
  // are `${filePath}:${hunkIndex}` (see DiffFile). An expansion is kept only
  // while its stored context lines are still contiguous with that hunk's
  // current boundaries — if the file changed underneath (edited from another
  // tab, committed away), stale lines would render against the wrong hunk,
  // corrupt further expand-range math, and leak into the review prompt.
  useEffect(() => {
    if (!files) return;
    const filesByPath = new Map(files.map((f) => [f.newPath, f]));
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
  }, [files, setHunkExpansions]);

  const expandContext = useCallback(
    async (
      filePath: string,
      hunkIndex: number,
      direction: "before" | "after",
      hunk: DiffHunk,
      prevHunk: DiffHunk | null,
      nextHunk: DiffHunk | null,
    ) => {
      const expansionKey = `${filePath}:${hunkIndex}`;
      // One request per chevron at a time. The range below is derived from what
      // is loaded, but only committed after the fetch — so a second click
      // before the first response landed read the same `beforeLines.length`,
      // computed the identical range, and both responses prepended it. Twenty
      // context lines rendered twice, and the prune effect could not tell: the
      // outermost line number still lines up with the hunk.
      const inFlightKey = `${expansionKey}:${direction}`;
      if (inFlight.current.has(inFlightKey)) return;

      const slot = { taskId: slotTask, key: slotKey };
      // The store rather than the map this render closed over: two chevrons can
      // be clicked inside one commit, and a click handler held from an earlier
      // render is older still.
      const loaded = getViewState(kind, slot).hunkExpansions;
      const existing = loaded.get(expansionKey) ?? noExpansion();

      let startLine: number;
      let endLine: number;

      if (direction === "before") {
        const currentFirstLine = hunk.newStart - existing.beforeLines.length;
        endLine = currentFirstLine - 1;
        startLine = Math.max(1, endLine - CONTEXT_LINES + 1);

        if (prevHunk) {
          const prevExpansion = loaded.get(`${filePath}:${hunkIndex - 1}`);
          const prevLoadedAfterCount = prevExpansion?.afterLines.length || 0;
          const prevHunkEnd = prevHunk.newStart + prevHunk.newCount - 1;
          let prevEffectiveEnd = prevHunkEnd + prevLoadedAfterCount;
          // The neighbour's own ⌄ may already be fetching into this gap. Its
          // lines are not in the map yet, but the range is spoken for, and the
          // guard above cannot see it — adjacent chevrons are two different
          // keys. Clamping only against what has *landed* is how the same ten
          // lines came back twice in one gap, with boundaries that still line
          // up with both hunks so the prune keeps them and `generatePrompt`
          // ships them to the agent.
          const claimed = inFlight.current.get(`${filePath}:${hunkIndex - 1}:after`);
          if (claimed) prevEffectiveEnd = Math.max(prevEffectiveEnd, claimed.endLine);
          startLine = Math.max(startLine, prevEffectiveEnd + 1);
        }
      } else {
        const hunkEnd = hunk.newStart + hunk.newCount - 1;
        startLine = hunkEnd + existing.afterLines.length + 1;
        endLine = startLine + CONTEXT_LINES - 1;

        if (nextHunk) {
          const nextExpansion = loaded.get(`${filePath}:${hunkIndex + 1}`);
          const nextLoadedBeforeCount = nextExpansion?.beforeLines.length || 0;
          let nextEffectiveStart = nextHunk.newStart - nextLoadedBeforeCount;
          // As above, from the other side of the gap.
          const claimed = inFlight.current.get(`${filePath}:${hunkIndex + 1}:before`);
          if (claimed) nextEffectiveStart = Math.min(nextEffectiveStart, claimed.startLine);
          endLine = Math.min(endLine, nextEffectiveStart - 1);
        }
      }

      if (startLine > endLine) return;
      // Claimed only once there is a range to claim, so the empty-gap bail
      // above has nothing to release.
      inFlight.current.set(inFlightKey, { startLine, endLine });

      try {
        const res = await fetch(
          `/api/tasks/${taskId}/context?file=${encodeURIComponent(filePath)}&start=${startLine}&end=${endLine}`,
        );
        if (!res.ok) return;
        const data = await res.json();

        const langConfig = getLanguageFromPath(filePath);
        const serverTokens = data.tokens as LineTokens[] | null | undefined;
        const contextLines: DiffLine[] = data.lines.map(
          (l: { lineNum: number; content: string }, i: number) => {
            const line: DiffLine = {
              type: "context" as const,
              content: l.content,
              oldLineNum: l.lineNum,
              newLineNum: l.lineNum,
            };
            // Prefer server tokens (validated inside applySyntaxToLine), else regex.
            line.segments = applySyntaxToLine(l.content, serverTokens?.[i] ?? null, langConfig);
            return line;
          },
        );

        setHunkExpansions((prev) => {
          const current = prev.get(expansionKey) ?? noExpansion();
          // `startLine`/`endLine` were computed against the hunk as it stood
          // when the chevron was clicked. If the diff was refetched while the
          // request was out — the agent edited the file and this hunk moved
          // twelve lines down — those numbers describe somewhere else in the
          // file, and committing them would render the wrong twenty lines
          // against the hunk until the *next* `files` change. The prune effect
          // is no help: it would find the stored lines contiguous with where
          // the hunk was, which is exactly what they are. So drop the response
          // instead. The chevron is live again, and one more click asks for the
          // right range.
          const now = filesRef.current?.find((f) => f.newPath === filePath)?.hunks[hunkIndex];
          if (!now) return prev;
          if (direction === "before") {
            if (now.newStart !== hunk.newStart) return prev;
            // And the lines the range was measured from are still the ones this
            // would prepend to — a prune between the click and the response
            // takes them away without the hunk moving at all.
            if (current.beforeLines.length !== existing.beforeLines.length) return prev;
          } else {
            if (now.newStart + now.newCount !== hunk.newStart + hunk.newCount) return prev;
            if (current.afterLines.length !== existing.afterLines.length) return prev;
          }

          const next = new Map(prev);
          if (direction === "before") {
            next.set(expansionKey, {
              ...current,
              beforeLines: [...contextLines, ...current.beforeLines],
              canExpandBefore: startLine > 1 && data.lines.length === endLine - startLine + 1,
            });
          } else {
            next.set(expansionKey, {
              ...current,
              afterLines: [...current.afterLines, ...contextLines],
              canExpandAfter: data.hasMore && data.lines.length === endLine - startLine + 1,
            });
          }
          return next;
        });
      } catch {
        // ignore
      } finally {
        // Released whether or not the range landed, so a failed request does
        // not leave the chevron permanently dead.
        inFlight.current.delete(inFlightKey);
      }
    },
    [taskId, kind, slotTask, slotKey, setHunkExpansions],
  );

  return { hunkExpansions, expandContext };
}
