import { useCallback, useMemo, useRef, useState, type CSSProperties } from "react";
import { nextPaneWidth } from "@/frontend/components/tabs/drag";
import {
  loadPaneWidth,
  savePaneWidth,
  PANE_MIN_PX,
  PANE_MIN_REST_PX,
  type PaneId,
} from "@/frontend/pane-size-store";

export interface PaneWidth {
  /** The width the user chose. What is stored, and what the pane asks for — not
   * necessarily what it gets on a window too narrow to grant it. */
  width: number;
  /** Spread onto the resizable pane. */
  paneProps: { ref: (el: HTMLElement | null) => void; style: CSSProperties };
  /** Spread onto the sibling the drag takes from — the main area, the diff. */
  restProps: { ref: (el: HTMLElement | null) => void; style: CSSProperties };
  onResizeStart: () => void;
  onResize: (deltaPx: number) => void;
  /** Writes the dragged width down. Must be wired to the handle, or a drag
   * lasts only until the next reload. */
  onResizeEnd: () => void;
  onNudge: (deltaPx: number) => void;
}

/**
 * A resizable pane's width, persisted per device.
 *
 * The stored width is read during the first render, not in an effect: a width
 * that arrives a frame late is a panel that paints its default and then jumps,
 * and there is nothing to wait for — `localStorage` is synchronous.
 *
 * **The pane asks for a width; it does not take one.** What is stored is what
 * the user dragged to, always, and a window too narrow to grant it never
 * rewrites it — an afternoon on a laptop must not cost the layout set on the
 * monitor. Fitting it is left to flexbox: the width is a `flex-basis` the pane
 * may shrink from, floored by `min-width`, and the sibling carries a floor of
 * its own. So an over-wide stored width shrinks to fit instead of pushing the
 * main area off screen, and unplugging the laptop gives it straight back.
 *
 * That division is not a stylistic one. Measuring the pane against its
 * neighbour and clamping in an effect is the obvious implementation and it
 * oscillates: the shell has *two* sidebars sharing one main area, so the room
 * one gives up is room the other immediately sees as free, takes, and gives
 * back — a loop with no fixed point, at animation-frame speed. The constraint
 * is over all three panes at once, which is precisely the problem the flex
 * algorithm already solves, and solves in one pass. Nothing here should grow
 * back into a second solver for it.
 *
 * What is left for JavaScript is the drag itself, where the limits must be
 * known in pixels to keep the boundary under the pointer.
 */
export function usePaneWidth(id: PaneId, side: "left" | "right"): PaneWidth {
  const [width, setWidth] = useState(() => loadPaneWidth(id));

  const paneEl = useRef<HTMLElement | null>(null);
  const restEl = useRef<HTMLElement | null>(null);

  /** The two panes either side of the divider, as laid out right now. Read at
   * the start of a gesture and not during it: this is the total the drag moves
   * a boundary within, and re-reading it mid-drag would let it drift. */
  const measure = useCallback(() => {
    const pane = paneEl.current?.getBoundingClientRect().width ?? 0;
    const rest = restEl.current?.getBoundingClientRect().width ?? 0;
    return { pane, pair: pane + rest };
  }, []);

  /** The width as of the last move, so the end of the gesture knows what to
   * write without the caller having to hand it back. */
  const latest = useRef(width);

  /**
   * Show a width now; persist it only when asked.
   *
   * `savePaneWidth` is a read-modify-write of `localStorage` — `getItem`,
   * `JSON.parse`, `JSON.stringify`, `setItem` — and every one of those is
   * synchronous on the main thread. Running it per `pointermove`, which is a
   * frame or better, is a drag that stutters against its own persistence for
   * no gain: nothing reads the record until the next load, so the only write
   * that matters is the last one.
   */
  const show = useCallback((px: number) => {
    latest.current = px;
    setWidth(px);
  }, []);

  const persist = useCallback(() => {
    savePaneWidth(id, latest.current);
  }, [id]);

  // Where the pane actually was when the pointer went down — its laid-out
  // width, which on a narrow window is not the width it asked for. Every move
  // is measured from here rather than from the live rect: resizing off the
  // current frame compounds its own rounding until the boundary drifts away
  // from the pointer, and a drag run past the floor and back would return from
  // the floor instead of from where it started.
  const from = useRef({ pane: 0, pair: 0 });

  const onResizeStart = useCallback(() => {
    from.current = measure();
  }, [measure]);

  const onResize = useCallback(
    (deltaPx: number) => {
      const { pane, pair } = from.current;
      show(nextPaneWidth(pane, deltaPx, side, pair, PANE_MIN_PX, PANE_MIN_REST_PX));
    },
    [show, side],
  );

  // One key press is one width, so there is no burst to coalesce.
  const onNudge = useCallback(
    (deltaPx: number) => {
      const { pane, pair } = measure();
      show(nextPaneWidth(pane, deltaPx, side, pair, PANE_MIN_PX, PANE_MIN_REST_PX));
      persist();
    },
    [measure, persist, show, side],
  );

  const paneProps = useMemo(
    () => ({
      ref: (el: HTMLElement | null) => {
        paneEl.current = el;
      },
      // `flexBasis` and not `width`, so the pane is shrinkable rather than
      // fixed — a `width` on a `flex-none` pane is what pushes the main area
      // off the screen. `minWidth` is the floor the shrinking stops at, so
      // there is always a pane left to put the handle against.
      style: {
        flexGrow: 0,
        flexShrink: 1,
        flexBasis: width,
        minWidth: PANE_MIN_PX,
      } satisfies CSSProperties,
    }),
    [width],
  );

  const restProps = useMemo(
    () => ({
      ref: (el: HTMLElement | null) => {
        restEl.current = el;
      },
      // A real basis, not `flex-1`'s zero: an item with a zero basis is not
      // part of a shrink, so the row would overflow rather than take the
      // difference out of the pane. The matching `minWidth` is what stops the
      // pane's own floor from being the only one honoured.
      style: {
        flexGrow: 1,
        flexShrink: 1,
        flexBasis: PANE_MIN_REST_PX,
        minWidth: PANE_MIN_REST_PX,
      } satisfies CSSProperties,
    }),
    [],
  );

  return { width, paneProps, restProps, onResizeStart, onResize, onResizeEnd: persist, onNudge };
}
