import { useCallback, useState } from "react";
import { loadLayout, saveLayout, type TaskLayout } from "@/frontend/layout-store";

/**
 * The selected task's layout, read from storage and written back on every
 * change (§7.2).
 *
 * Loaded during render rather than in an effect: a layout that arrives one
 * frame late means the shell paints an empty main area first, and the layout is
 * a synchronous `localStorage` read with nothing to wait for.
 */
export function useTaskLayout(taskId: string | null): {
  layout: TaskLayout | null;
  setLayout: (next: TaskLayout) => void;
} {
  const [held, setHeld] = useState<{ id: string | null; layout: TaskLayout | null }>(() => ({
    id: taskId,
    layout: taskId ? loadLayout(taskId) : null,
  }));

  // React's own "adjust state when a prop changes" pattern: the set during
  // render is discarded and re-run before anything is committed, so nothing
  // ever paints the previous task's tabs under the new task's name.
  if (held.id !== taskId) {
    setHeld({ id: taskId, layout: taskId ? loadLayout(taskId) : null });
  }

  const setLayout = useCallback(
    (next: TaskLayout) => {
      if (!taskId) return;
      saveLayout(taskId, next);
      setHeld({ id: taskId, layout: next });
    },
    [taskId],
  );

  return { layout: held.id === taskId ? held.layout : null, setLayout };
}
