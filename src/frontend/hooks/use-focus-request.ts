import { useEffect, useRef, type RefObject } from "react";

/**
 * Answers the shell's focus pulse (TASK-34): a rising `request` is the
 * keyboard asking this pane to take the caret, and `target` is what takes it —
 * a terminal handle or a plain element, anything with `focus()`.
 *
 * Zero is "not you": every pane the pulse is not addressed to holds it, so a
 * pulse reaches exactly one pane. Not folded into `visible`, which is per-group
 * and true for both panes of a split, and which also turns over on a mouse
 * click that should go on doing what it always has.
 *
 * Only on a *rise*, measured from what the pane mounted with: `TabPane` is
 * keyed by task, so leaving a task and coming back remounts the pane with
 * whatever number was standing, and focusing on that would take the caret out
 * of the sidebar's filter on the click that selected the task.
 *
 * One hook rather than the same four lines in each pane, because the
 * mount-baseline rule is the subtle part and the one a copy would get wrong.
 */
export function useFocusRequest(
  request: number,
  target: RefObject<{ focus(): void } | null>,
): void {
  const seen = useRef(request);
  useEffect(() => {
    if (request && request !== seen.current) target.current?.focus();
    seen.current = request;
  }, [request, target]);
}
