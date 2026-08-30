import { useCallback, useState } from "react";
import { loadLayout, saveLayout, type TaskLayout } from "@/frontend/layout-store";
import { retainViewStates } from "@/frontend/view-state-store";

/** Every tab key the layout currently holds. A split puts one key in two
 * groups, so this is a set rather than a list. */
function liveKeys(layout: TaskLayout): Set<string> {
  const keys = new Set<string>();
  for (const group of layout.groups) {
    for (const tab of group.tabs) keys.add(tab.key);
  }
  return keys;
}

/**
 * The selected task's layout, read from storage and written back on every
 * change (§7.2).
 *
 * Loaded during render rather than in an effect: a layout that arrives one
 * frame late means the shell paints an empty main area first, and the layout is
 * a synchronous `localStorage` read with nothing to wait for.
 *
 * The layout is also what decides how long a tab's view state lives. Because
 * `view-state-store` is keyed by tab key, "this tab is gone" and "its scroll
 * offset is gone" are the same fact, and pruning here is the only place that
 * has to know it. Pruning on load matters as much as on change: a tab closed
 * on another device is absent from the layout that comes back, and its state
 * would otherwise sit in storage forever. It rides along with the load rather
 * than waiting for an effect because it is idempotent — pruning the same
 * layout twice prunes nothing the second time — so a discarded render or
 * StrictMode's double invoke costs nothing and cannot prune the wrong task.
 */
export function useTaskLayout(taskId: string | null): {
  layout: TaskLayout | null;
  setLayout: (next: TaskLayout) => void;
} {
  const load = (id: string | null): TaskLayout | null => {
    if (!id) return null;
    const layout = loadLayout(id);
    retainViewStates(id, liveKeys(layout));
    return layout;
  };

  const [held, setHeld] = useState<{ id: string | null; layout: TaskLayout | null }>(() => ({
    id: taskId,
    layout: load(taskId),
  }));

  // React's own "adjust state when a prop changes" pattern: the set during
  // render is discarded and re-run before anything is committed, so nothing
  // ever paints the previous task's tabs under the new task's name.
  if (held.id !== taskId) {
    setHeld({ id: taskId, layout: load(taskId) });
  }

  const setLayout = useCallback(
    (next: TaskLayout) => {
      if (!taskId) return;
      saveLayout(taskId, next);
      retainViewStates(taskId, liveKeys(next));
      setHeld({ id: taskId, layout: next });
    },
    [taskId],
  );

  return { layout: held.id === taskId ? held.layout : null, setLayout };
}
