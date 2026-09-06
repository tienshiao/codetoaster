/**
 * The scroll offset that brings a tab fully into view, moving as little as
 * possible.
 *
 * `tabStart` and `tabEnd` are the tab's edges within the scroll content — the
 * container's own coordinate space, before scrolling is subtracted. A tab that
 * is already wholly visible gets the same `scrollLeft` back, so a caller can
 * compare by value and skip the write. A tab wider than the container is
 * aligned to its leading edge: the start of a label is the part worth seeing.
 *
 * Pure, and kept apart from `TabStrip` so `bun test` can cover it without a
 * DOM; the strip's effect only measures and hands the numbers here.
 */
export function revealScrollLeft(
  scrollLeft: number,
  clientWidth: number,
  tabStart: number,
  tabEnd: number,
): number {
  if (tabStart < scrollLeft) return tabStart;
  if (tabEnd > scrollLeft + clientWidth) return Math.min(tabStart, tabEnd - clientWidth);
  return scrollLeft;
}
