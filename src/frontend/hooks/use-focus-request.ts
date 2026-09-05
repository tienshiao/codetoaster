import { useEffect, useRef, type RefObject } from "react";

/**
 * The rising edge of a pulse, as a hook.
 *
 * A pulse is a counter the shell increments to address exactly one pane: zero
 * is "not you", so every pane the pulse is not for holds it, and the one it is
 * for sees a number that went up. `onRise` fires on that, and on nothing else —
 * not on the fall back to zero, which is another pane being addressed.
 *
 * Only on a rise *measured from what the pane mounted with*, which is the
 * subtle part and the one a copy would get wrong: `TabPane` is keyed by task,
 * so leaving a task and coming back remounts the pane with whatever number was
 * standing, and acting on that would take the caret out of the sidebar's filter
 * on the click that selected the task.
 *
 * `onRise` is read through a ref rather than depended on: callers pass an
 * inline closure whose identity changes every render, and a dependency on it
 * would re-run the effect — and re-fire — on renders where the request never
 * moved.
 */
export function usePulse(request: number, onRise: () => void): void {
  const seen = useRef(request);
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
 * what it always has. The rising-edge and mount-baseline rules are `usePulse`'s.
 */
export function useFocusRequest(
  request: number,
  target: RefObject<{ focus(): void } | null>,
): void {
  usePulse(request, () => target.current?.focus());
}
