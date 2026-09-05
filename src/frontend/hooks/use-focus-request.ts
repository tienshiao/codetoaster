import { useEffect, useRef, type RefObject } from "react";

/**
 * The rising edge of a pulse, as a hook.
 *
 * A pulse is a counter the shell increments to address exactly one pane: zero
 * is "not you", so every pane the pulse is not for holds it, and the one it is
 * for sees a number that went up. `onRise` fires on that, and on nothing else —
 * not on the fall back to zero, which is another pane being addressed.
 *
 * A pane that *mounts* holding a non-zero number fires too, and this is the
 * part a copy would get wrong in either direction. A non-terminal pane is only
 * mounted while its tab is in front, so a chord onto a diff tab mounts the pane
 * in the very commit the pulse rises in — measured from what it mounted with,
 * that is not a rise, and the caret stayed in the PTY. The other direction is
 * the one the mount baseline used to guard: `TabPane` is keyed by task, and a
 * pane remounted by a click on a task row must not act on a number a chord
 * left standing an hour ago. What squares the two is the shell's side of the
 * contract — `TaskShell` clears a pulse in the effect after the commit it rose
 * in, so a non-zero number is never *standing*: a pane that mounts holding one
 * was mounted by that pulse, and it is the one being addressed.
 *
 * `onRise` is read through a ref rather than depended on: callers pass an
 * inline closure whose identity changes every render, and a dependency on it
 * would re-run the effect — and re-fire — on renders where the request never
 * moved.
 */
export function usePulse(request: number, onRise: () => void): void {
  const seen = useRef(0);
  const handler = useRef(onRise);
  handler.current = onRise;
  useEffect(() => {
    if (request && request !== seen.current) handler.current();
    seen.current = request;
  }, [request]);
}

/**
 * Answers the shell's focus pulse (TASK-34): a rising `request` is the
 * keyboard asking this pane to take the caret, and `target` is what takes it —
 * a terminal handle or a plain element, anything with `focus()`.
 *
 * Not folded into `visible`, which is per-group and true for both panes of a
 * split, and which also turns over on a mouse click that should go on doing
 * what it always has. The rising-edge and mount rules are `usePulse`'s.
 */
export function useFocusRequest(
  request: number,
  target: RefObject<{ focus(): void } | null>,
): void {
  usePulse(request, () => target.current?.focus());
}
