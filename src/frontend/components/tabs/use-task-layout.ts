import { useCallback, useState } from "react";
import {
  loadLayout,
  mergeGroups,
  saveLayout,
  type LayoutEnv,
  type TaskLayout,
} from "@/frontend/layout-store";
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
 *
 * The device's policy (`LayoutEnv`) is applied here, at the one boundary every
 * layout crosses, rather than by an effect over the result. Under
 * `singleGroup` a split stored from a wider screen is folded on the way in —
 * during the same render that loads it, so a phone never paints two columns —
 * and every write is folded on the way out, so an edit `TabArea` derived from
 * the folded layout cannot bring the split back. Folding on both sides is what
 * makes the projection safe: the round trip that would undo a read-side merge
 * is closed at the write. And a visit that edits nothing writes nothing, so a
 * desktop window dragged narrow for a moment does not have its split rewritten
 * in storage; the first edit made while narrow is the one that persists the
 * fold. `mergeGroups` is the identity on one group, so on a desktop none of
 * this costs a comparison.
 *
 * `setLayout` returns the layout it committed — the folded one — so a caller
 * keeping its own copy (`TaskShell`'s `layoutRef`) holds what the store holds.
 */
export function useTaskLayout(
  taskId: string | null,
  env: LayoutEnv = {},
): {
  layout: TaskLayout | null;
  setLayout: (next: TaskLayout) => TaskLayout;
} {
  const single = env.singleGroup === true;
  const fold = (layout: TaskLayout): TaskLayout => (single ? mergeGroups(layout) : layout);

  const load = (id: string | null): TaskLayout | null => {
    if (!id) return null;
    const layout = fold(loadLayout(id));
    retainViewStates(id, liveKeys(layout));
    return layout;
  };

  const [held, setHeld] = useState<{ id: string | null; layout: TaskLayout | null }>(() => ({
    id: taskId,
    layout: load(taskId),
  }));

  // React's own "adjust state when a prop changes" pattern: the set during
  // render is discarded and re-run before anything is committed, so nothing
  // ever paints the previous task's tabs under the new task's name — and, by
  // the same pattern, a viewport that crosses below the breakpoint with a
  // split on screen folds it before the next paint rather than after one.
  // Neither branch runs twice: a loaded layout is already folded, and a folded
  // one has one group.
  if (held.id !== taskId) {
    setHeld({ id: taskId, layout: load(taskId) });
  } else if (single && held.layout && held.layout.groups.length > 1) {
    setHeld({ id: taskId, layout: mergeGroups(held.layout) });
  }

  const setLayout = useCallback(
    (next: TaskLayout) => {
      const committed = single ? mergeGroups(next) : next;
      if (!taskId) return committed;
      saveLayout(taskId, committed);
      retainViewStates(taskId, liveKeys(committed));
      setHeld({ id: taskId, layout: committed });
      return committed;
    },
    [taskId, single],
  );

  return { layout: held.id === taskId ? held.layout : null, setLayout };
}
