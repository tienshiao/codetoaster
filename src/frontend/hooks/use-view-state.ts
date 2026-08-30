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
 * A tab host is bound to one `ref` for its lifetime, since a tab's key *is* its
 * React key. That is the whole reason the old `useGitDetailState` and its
 * stale-slot guard are gone: a commit tab's key carries the sha, so there is no
 * second identity to fall out of step with. The Explorer is the other case —
 * its sections are drawn at a fixed position with no `key`, deliberately, so
 * `taskId` moves underneath a mounted instance — and the value has to move with
 * it in the *same* render, which is what the adjust below is for.
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
  // Destructured rather than depending on `ref`, so a caller passing an inline
  // `{ taskId, key }` object does not rebuild the setter every render.
  const { taskId, key } = ref;

  // The value is held *with* the slot it was read from, because the setter
  // rebinds the instant `ref` changes and the two must never describe different
  // slots. They did: the value was bound once by this initializer while the
  // setter followed `taskId`, so for the one render after an Explorer task
  // switch, FileTree's reveal effect saw the previous task's `selectedFile`
  // through a setter pointing at the new task and wrote the old file's ancestor
  // directories into the new task's tree. Child effects run before this hook's
  // correcting subscription, so an effect cannot be what fixes it.
  const [held, setHeld] = useState<{ taskId: string; key: string; value: V }>(() => ({
    taskId,
    key,
    value: getViewState(kind, ref)[field],
  }));

  // React's own "adjust state when a prop changes": the set during render is
  // discarded and re-run before anything commits, and `value` is computed here
  // rather than read back from `held` so even that discarded render is honest.
  let value = held.value;
  if (held.taskId !== taskId || held.key !== key) {
    value = getViewState(kind, { taskId, key })[field];
    setHeld({ taskId, key, value });
  }

  // Follow the slot for as long as this instance is bound to it, so a write
  // from another pane reaches this one's render as well as the store.
  useEffect(() => {
    const slot = { taskId, key };
    // Returning `prev` unchanged when nothing moved keeps a write that resolves
    // to the value already held — the common case for a `scrollTop` that landed
    // on the same pixel — from re-rendering every pane on the field.
    const read = () =>
      setHeld((prev) => hold(prev, taskId, key, getViewState(kind, slot)[field]));
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
      setHeld((current) => hold(current, taskId, key, resolved));
    },
    [kind, taskId, key, field],
  );
  return [value, set];
}

/** The held triple, reusing `prev` when it already says exactly this — so a
 * no-op write stays a no-op render. */
function hold<V>(
  prev: { taskId: string; key: string; value: V },
  taskId: string,
  key: string,
  value: V,
): { taskId: string; key: string; value: V } {
  if (prev.taskId === taskId && prev.key === key && Object.is(prev.value, value)) return prev;
  return { taskId, key, value };
}
