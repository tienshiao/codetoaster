import { useEffect, useRef, type MouseEvent } from "react";
import { symbolRangeAtPoint } from "../utils/symbolClick";
import { setSymbolHighlight, clearSymbolHighlight } from "../utils/symbolHighlight";

interface RangeSig {
  node: Node;
  start: number;
  end: number;
}

/**
 * Underlines the exact identifier under the cursor while `active` (the modifier
 * is held), mirroring VSCode's Ctrl/Cmd-click link. Returns handlers to spread
 * on the code container.
 *
 * Pass `resetKey` (e.g. the rendered content/diff) so a live highlight is
 * cleared when the DOM re-renders out from under its Range — otherwise the
 * underline would strand on a detached node until the next mousemove. Also
 * clears when `active` goes false, on pointer-leave, and on unmount.
 */
export function useSymbolHighlight(active: boolean, resetKey?: unknown) {
  // Signature of the currently-highlighted range, so we skip rebuilding the
  // highlight while the pointer stays over the same identifier.
  const lastRef = useRef<RangeSig | null>(null);

  useEffect(() => {
    lastRef.current = null;
    if (!active) clearSymbolHighlight();
    return () => {
      lastRef.current = null;
      clearSymbolHighlight();
    };
  }, [active, resetKey]);

  return {
    onMouseMove: (e: MouseEvent) => {
      if (!active) return;
      const hit = symbolRangeAtPoint(e.clientX, e.clientY);
      if (!hit) {
        if (lastRef.current) {
          lastRef.current = null;
          clearSymbolHighlight();
        }
        return;
      }
      const { range } = hit;
      const last = lastRef.current;
      if (
        last &&
        last.node === range.startContainer &&
        last.start === range.startOffset &&
        last.end === range.endOffset
      ) {
        return; // still over the same identifier — nothing to rebuild
      }
      lastRef.current = { node: range.startContainer, start: range.startOffset, end: range.endOffset };
      setSymbolHighlight(range);
    },
    onMouseLeave: () => {
      lastRef.current = null;
      clearSymbolHighlight();
    },
  };
}
