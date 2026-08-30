import { useState, useCallback, useEffect, type Dispatch, type SetStateAction } from "react";
import {
  getViewState,
  setViewField,
  subscribeViewField,
  type ViewRef,
  type ViewSlotKind,
  type ViewStateShapes,
} from "../view-state-store";

/**
 * useState backed by the view-state store: hydrates from the slot on mount and
 * writes through on every set.
 *
 * A hook instance is bound to one `ref` for its lifetime, so a component whose
 * view changes identity must remount — which the tab hosts get for free, since
 * a tab's key *is* its React key. That is the whole reason the old
 * `useGitDetailState` and its stale-slot guard are gone: a commit tab's key
 * carries the sha, so there is no second identity to fall out of step with.
 *
 * The store, not this hook's copy, is the value. A split can put two live panes
 * on one slot — the all-files diff beside a single file of it share the task's
 * one `review` — and each would otherwise resolve its updates against a copy
 * taken before the other's write, quietly throwing that write away.
 */
export function useViewState<K extends ViewSlotKind, F extends keyof ViewStateShapes[K]>(
  kind: K,
  ref: ViewRef,
  field: F,
): [ViewStateShapes[K][F], Dispatch<SetStateAction<ViewStateShapes[K][F]>>] {
  type V = ViewStateShapes[K][F];
  const [value, setValue] = useState<V>(() => getViewState(kind, ref)[field]);
  // Destructured rather than depending on `ref`, so a caller passing an inline
  // `{ taskId, key }` object does not rebuild the setter every render.
  const { taskId, key } = ref;

  // Follow the slot for as long as this instance is bound to it, so a write
  // from another pane reaches this one's render as well as the store.
  useEffect(() => {
    const slot = { taskId, key };
    const read = () => setValue(getViewState(kind, slot)[field]);
    // Also catches a write that landed between the mount-time read above and
    // this subscription.
    read();
    return subscribeViewField(slot, field as string, read);
  }, [kind, taskId, key, field]);

  const set = useCallback<Dispatch<SetStateAction<V>>>(
    (next) => {
      const slot = { taskId, key };
      const prev = getViewState(kind, slot)[field];
      const resolved = typeof next === "function" ? (next as (p: V) => V)(prev) : next;
      // Writing notifies every other instance on this field, including nothing
      // at all when this pane is the only one open.
      setViewField(kind, slot, field, resolved);
      setValue(resolved);
    },
    [kind, taskId, key, field],
  );
  return [value, set];
}
