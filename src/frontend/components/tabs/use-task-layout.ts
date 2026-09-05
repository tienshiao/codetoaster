import { useCallback, useRef, useState } from "react";
import {
  activeTab,
  differsOnlyInFocus,
  focusTab,
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

/** The layout as the device shows it: the stored one, folded to one group
 * under `singleGroup`. `mergeGroups` is the identity on one group, so on a
 * desktop this is the stored layout itself and costs a comparison. */
function project(stored: TaskLayout | null, single: boolean): TaskLayout | null {
  return stored && single ? mergeGroups(stored) : stored;
}

interface Held {
  id: string | null;
  /** What storage holds — the layout as a wider screen last left it. */
  stored: TaskLayout | null;
  /** What the shell renders — `project(stored, single)`, kept rather than
   * recomputed so its identity is stable across renders and a caller can
   * compare against it. */
  shown: TaskLayout | null;
  /** The policy `shown` was projected under. */
  single: boolean;
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
 * ## The fold is a projection
 *
 * The device's policy (`LayoutEnv`) is applied here, at the one boundary every
 * layout crosses. Under `singleGroup` the hook holds two layouts: the one
 * storage has, which may be a split written on a wider screen, and the one the
 * shell renders, which is that layout folded to one group — during the same
 * render that loads it, so a phone never paints two columns, and again in the
 * render where a viewport crosses the breakpoint, in either direction. A
 * desktop window docked narrow for a moment and widened again gets its split
 * back, because the split was never rewritten: the fold is how the stored
 * layout is *shown*, not what it becomes.
 *
 * Writes come in two shapes, and which shape decides what the fold does to the
 * stored split:
 *
 *  - `editLayout(fn)` applies a reducer to the *stored* layout, and is for the
 *    edits the shell makes on its own behalf — a `?tab=` link, a shell tab
 *    whose PTY is gone, a file opened from the Explorer. On a phone `fn` runs
 *    over the split, so the split survives it; the result is folded for the
 *    screen. These are the writes that fire with no gesture behind them, and a
 *    phone visit that merely *loaded* a task was persisting the fold through
 *    them.
 *  - `setLayout(next)` takes a whole layout that `TabArea` or the keymap
 *    derived from the shown one — one group, on a phone — and stores it. One
 *    case is rebased first: a `next` that only moves focus (a tap on a tab, a
 *    `⌘K ]`) is applied to the stored split as a focus, by tab id, since the
 *    fold keeps the surviving copies' ids. Anything else — an open, a close, a
 *    drag — is a layout the user built on this device, and it is stored as
 *    built: the fold that persists is the one they made.
 *
 * On a desktop the two are the same thing, and the stored and shown layouts
 * are one object.
 *
 * Both return the layout the shell should now hold — the projection — so a
 * caller keeping its own copy (`TaskShell`'s `layoutRef`) holds what the store
 * shows. A write that changes nothing writes nothing and returns what was
 * already shown, so a caller can compare by identity.
 */
export function useTaskLayout(
  taskId: string | null,
  env: LayoutEnv = {},
): {
  layout: TaskLayout | null;
  setLayout: (next: TaskLayout) => TaskLayout;
  editLayout: (fn: (stored: TaskLayout) => TaskLayout) => TaskLayout | null;
} {
  const single = env.singleGroup === true;

  const load = (id: string | null): Held => {
    const stored = id ? loadLayout(id) : null;
    if (id && stored) retainViewStates(id, liveKeys(stored));
    return { id, stored, shown: project(stored, single), single };
  };

  const [held, setHeld] = useState<Held>(() => load(taskId));
  // The latest committed state, for the two writers below: they are stable
  // callbacks and a `held` closed over at render time is stale by the second
  // write inside one event — `⌘K ] ⌘K ]` typed at speed.
  const heldRef = useRef(held);
  heldRef.current = held;

  // React's own "adjust state when a prop changes" pattern: the set during
  // render is discarded and re-run before anything is committed, so nothing
  // ever paints the previous task's tabs under the new task's name — and, by
  // the same pattern, a viewport that crosses the breakpoint re-projects the
  // stored layout before the next paint rather than after one. Neither branch
  // runs twice: the second sets `single` to what it is being compared with.
  if (held.id !== taskId) {
    setHeld(load(taskId));
  } else if (held.single !== single) {
    setHeld({ ...held, shown: project(held.stored, single), single });
  }

  /** Store a layout, show its projection, and hand the projection back. */
  const commit = useCallback(
    (id: string, stored: TaskLayout): TaskLayout => {
      const next: Held = { id, stored, shown: project(stored, single)!, single };
      saveLayout(id, stored);
      retainViewStates(id, liveKeys(stored));
      heldRef.current = next;
      setHeld(next);
      return next.shown!;
    },
    [single],
  );

  const setLayout = useCallback(
    (next: TaskLayout): TaskLayout => {
      const current = heldRef.current;
      if (!taskId || current.id !== taskId || !current.stored || !current.shown) {
        return project(next, single)!;
      }
      if (next === current.shown) return current.shown;
      let stored = next;
      if (single) {
        const front = activeTab(next);
        stored =
          front && differsOnlyInFocus(current.shown, next)
            ? focusTab(current.stored, front.id)
            : mergeGroups(next);
      }
      return commit(taskId, stored);
    },
    [taskId, single, commit],
  );

  const editLayout = useCallback(
    (fn: (stored: TaskLayout) => TaskLayout): TaskLayout | null => {
      const current = heldRef.current;
      if (!taskId || current.id !== taskId || !current.stored) return null;
      const stored = fn(current.stored);
      if (stored === current.stored) return current.shown;
      return commit(taskId, stored);
    },
    [taskId, commit],
  );

  return { layout: held.id === taskId ? held.shown : null, setLayout, editLayout };
}
