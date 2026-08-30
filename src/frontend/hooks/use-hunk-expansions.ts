import { useCallback, useEffect, useRef } from "react";
import { useViewState } from "./use-view-state";
import { pruneMap, type ViewRef } from "../view-state-store";
import { applySyntaxToLine } from "../utils/wordDiff";
import { getLanguageFromPath } from "../utils/languageDetection";
import type { DiffHunk, DiffLine, FileDiff, HunkExpansionState } from "../types/diff";
import type { LineTokens } from "../../types/highlight";

const CONTEXT_LINES = 20;

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
  /** Ranges already being fetched, keyed `${filePath}:${hunkIndex}:${direction}`
   * — see `expandContext`. */
  const inFlight = useRef<Set<string>>(new Set());

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
      // One request per chevron at a time. The range below is derived from the
      // map as it was at render, but only committed after the fetch — so a
      // second click before the first response landed read the same
      // `beforeLines.length`, computed the identical range, and both responses
      // prepended it. Twenty context lines rendered twice, and the prune effect
      // could not tell: the outermost line number still lines up with the hunk.
      const inFlightKey = `${expansionKey}:${direction}`;
      if (inFlight.current.has(inFlightKey)) return;
      inFlight.current.add(inFlightKey);
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

      if (startLine > endLine) {
        inFlight.current.delete(inFlightKey);
        return;
      }

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
    [taskId, hunkExpansions, setHunkExpansions],
  );

  return { hunkExpansions, expandContext };
}
