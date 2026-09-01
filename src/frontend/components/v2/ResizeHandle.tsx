import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { cn } from "@/frontend/lib/utils";

/** How far an arrow key moves a divider. Matches the tab groups' nudge. */
const NUDGE_PX = 16;

export interface ResizeHandleProps {
  /** Named for what it divides — "Resize sidebar", not "Resize". It is the
   * only thing a screen reader has to go on, and the shell has four of these. */
  label: string;
  /** Called once on pointerdown, before any move: the caller's chance to
   * measure. Every `onResize` delta is from this instant. */
  onResizeStart?: () => void;
  onResize: (deltaPx: number) => void;
  onResizeEnd?: () => void;
  /** Arrow keys, for a divider that cannot be dragged with a pointer. Left is
   * negative, matching a pointer moving left. */
  onNudge?: (deltaPx: number) => void;
  className?: string;
}

/**
 * The grab handle on a vertical divider: pointer capture, the cursor, and a
 * target wide enough to hit.
 *
 * Generalised out of `TabArea`, which had the only one, so the shell's four
 * dividers — the two sidebars, the file tree, and the tab groups — behave
 * alike rather than diverging one bug fix at a time. The arithmetic behind
 * each is different (a tab group keeps a flex share, a sidebar keeps its
 * pixels) and stays with the caller; what is the same is everything here.
 *
 * The gesture is tracked on the `window`, not on the handle: a divider is 6px
 * wide and a pointer moving faster than the layout follows leaves it
 * immediately, and a drag that stops the moment the pointer is no longer over
 * a 6px target is a drag that does not work.
 */
export function ResizeHandle({
  label,
  onResizeStart,
  onResize,
  onResizeEnd,
  onNudge,
  className,
}: ResizeHandleProps) {
  const [resizing, setResizing] = useState(false);

  // One gesture at a time, and it must not outlive the component: a handle
  // unmounted mid-drag — the sidebar closed by the keyboard, a tab pane
  // replaced — would otherwise leave listeners on the window for the life of
  // the page and `<body>` stuck showing a resize cursor over everything.
  const releaseRef = useRef<(() => void) | null>(null);
  useEffect(() => () => releaseRef.current?.(), []);

  // Read through refs inside the window listeners: they are installed once per
  // gesture and would otherwise call the handler this render closed over.
  // `onResizeStart` needs this as much as the other two even though it fires
  // before any listener exists — `start` itself is memoised for the life of the
  // component, so a callback read straight from the closure would be the one
  // the *first* render supplied. `TabArea` measures the layout in there, and a
  // measurement of the layout as it was at mount is exactly the wrong one.
  const startRef = useRef(onResizeStart);
  startRef.current = onResizeStart;
  const resizeRef = useRef(onResize);
  resizeRef.current = onResize;
  const endRef = useRef(onResizeEnd);
  endRef.current = onResizeEnd;

  const start = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Or the drag selects the text of every pane it crosses on the way.
    e.preventDefault();
    releaseRef.current?.();

    const startX = e.clientX;
    startRef.current?.();
    setResizing(true);
    // Held on `<body>` rather than on the panes: the pointer is over whatever
    // the drag has crossed, not over the handle, so the cursor and the
    // selection guard have to apply to the document. See `index.css`.
    document.body.dataset.resizing = "col";

    const move = (ev: globalThis.PointerEvent) => resizeRef.current(ev.clientX - startX);
    // `pointercancel` matters as much as `pointerup`: a touch that turns into a
    // scroll, or a window that loses the pointer, otherwise leaves the whole
    // document showing a resize cursor with no gesture behind it.
    const done = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", done);
      window.removeEventListener("pointercancel", done);
      releaseRef.current = null;
      delete document.body.dataset.resizing;
      setResizing(false);
      endRef.current?.();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", done);
    window.addEventListener("pointercancel", done);
    releaseRef.current = done;
  }, []);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={onNudge ? 0 : -1}
      onPointerDown={start}
      onKeyDown={(e) => {
        if (!onNudge) return;
        if (e.key === "ArrowLeft") onNudge(-NUDGE_PX);
        else if (e.key === "ArrowRight") onNudge(NUDGE_PX);
        else return;
        e.preventDefault();
      }}
      // Pulled over the border it sits on: a 1px target is a target nobody
      // hits, and a 6px gutter between panes is visible slack.
      className={cn(
        "z-10 -mx-[3px] w-1.5 flex-none cursor-col-resize",
        "hover:bg-[oklch(var(--ct-blue-500-ch)/0.35)]",
        "focus-visible:bg-[oklch(var(--ct-blue-500-ch)/0.35)] focus-visible:outline-none",
        resizing && "bg-[oklch(var(--ct-blue-500-ch)/0.35)]",
        className,
      )}
    />
  );
}
