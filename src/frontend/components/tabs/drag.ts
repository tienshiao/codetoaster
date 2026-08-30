/**
 * The geometry a tab drag and a group resize need, with no DOM in it.
 *
 * The components measure — `getBoundingClientRect` on things carrying
 * `data-tab-id` / `data-tab-group` — and these answer. Keeping the arithmetic
 * here is what makes "which side of that tab did I drop on" testable without a
 * browser, and it is the half that is actually easy to get wrong.
 */

export interface TabBox {
  id: string;
  left: number;
  width: number;
}

/**
 * Where a drop at `x` inserts, as an index into the group's tabs.
 *
 * A tab's midpoint is the boundary: past it, the drop goes after that tab. Any
 * x beyond the last tab — the empty stretch of strip, which is a real place to
 * aim — appends.
 */
export function dropIndexAt(boxes: readonly TabBox[], x: number): number {
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i]!;
    if (x < box.left + box.width / 2) return i;
  }
  return boxes.length;
}

/**
 * The index a move should be given, once the tab being dragged is taken out.
 *
 * Within its own group, `moveTab` removes the tab before inserting, so an index
 * computed against the strip as the user sees it is one too many for every
 * position right of the tab's own. Dropping either side of itself is a no-op,
 * and saying so here keeps a jitter of one-pixel moves from rewriting the
 * layout on every pointermove.
 */
export function moveIndexFor(
  boxes: readonly TabBox[],
  dropIndex: number,
  draggedId: string,
): number | null {
  const from = boxes.findIndex((b) => b.id === draggedId);
  if (from === -1) return dropIndex;
  if (dropIndex === from || dropIndex === from + 1) return null;
  return dropIndex > from ? dropIndex - 1 : dropIndex;
}

/**
 * Move the boundary between groups `index` and `index + 1` by `deltaPx`.
 *
 * Flex shares, not pixels, are what the layout stores — a persisted split has
 * to survive the window being a different width — so the drag is done in pixels
 * and converted back. Only the two groups either side of the boundary change:
 * the total they occupy is fixed, so every other group's share stays exactly
 * where the user put it.
 *
 * `minPx` is a floor, not a suggestion: a group dragged to zero width is a
 * group with no way back, since there is nothing left to grab.
 */
export function resizeFlex(
  flexes: readonly number[],
  widths: readonly number[],
  index: number,
  deltaPx: number,
  minPx = 120,
): number[] {
  const next = [...flexes];
  const left = widths[index];
  const right = widths[index + 1];
  const leftFlex = flexes[index];
  const rightFlex = flexes[index + 1];
  if (left == null || right == null || leftFlex == null || rightFlex == null) return next;

  const pair = left + right;
  // Two groups narrower than two minimums cannot both be honoured; refusing
  // beats splitting the difference and leaving one of them unusable.
  if (pair < minPx * 2) return next;

  const clamped = Math.max(minPx, Math.min(pair - minPx, left + deltaPx));
  const pairFlex = leftFlex + rightFlex;
  next[index] = (pairFlex * clamped) / pair;
  next[index + 1] = pairFlex - next[index]!;
  return next;
}
