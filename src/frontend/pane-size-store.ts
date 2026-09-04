// The width of every pane whose divider the user can drag (§TASK-69): the task
// sidebar, the Explorer, and the file tree the diff, file browser and commit
// detail all share.
//
// Per device and not per task, for the same reason as `explorer-store`: how
// wide a column is is a property of the monitor it is being read on, not of the
// work shown in it. Per device means across every tab open on it: a `storage`
// event carries a width written in one tab into the others, so widths cross
// tabs the way they cross reloads. One key holds all of them, so a new resizable
// pane costs an id and nothing else — and so the whole record is validated in
// one pass rather than each pane trusting its own slot.
//
// What is stored is what the user *asked for*, never what a narrow window could
// afford at the time. `use-pane-width` clamps for the render and leaves the
// stored number alone, so working on a laptop for an afternoon does not quietly
// rewrite the widths set on the monitor.

import { createKeyedListeners } from "./keyed-listeners";

export const PANE_MIN_PX = 160;

/** Room the pane beside a divider keeps, so it is never squeezed to nothing. */
export const PANE_MIN_REST_PX = 240;

export type PaneId = "sidebar" | "explorer" | "file-tree";

export const PANE_DEFAULT_PX: Record<PaneId, number> = {
  sidebar: 240,
  explorer: 272,
  "file-tree": 280,
};

export type PaneWidths = Partial<Record<PaneId, number>>;

const STORAGE_KEY = "codetoaster:pane-widths";

/** localStorage throws rather than no-ops in a private window with site data
 * blocked, and is simply absent under a test runner — neither is a reason for
 * the shell to fail to render. */
function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isPaneId(value: string): value is PaneId {
  return value in PANE_DEFAULT_PX;
}

/**
 * Rebuild the stored widths, dropping anything that is not a usable number.
 *
 * A width reaches a `style` attribute, so `NaN`, a string, `Infinity` and a
 * negative are all a pane that renders at some width nobody can explain — and
 * `JSON.parse` will hand back every one of them from a record written by an
 * older build or edited by hand. Unknown ids are dropped rather than kept:
 * carrying a pane that no longer exists means the record grows forever.
 */
export function revivePaneWidths(value: unknown): PaneWidths {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: PaneWidths = {};
  for (const [id, px] of Object.entries(value as Record<string, unknown>)) {
    if (!isPaneId(id)) continue;
    if (typeof px !== "number" || !Number.isFinite(px) || px <= 0) continue;
    out[id] = px;
  }
  return out;
}

/** Every stored width. Never throws. */
export function loadPaneWidths(): PaneWidths {
  const store = storage();
  if (!store) return {};
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return {};
    return revivePaneWidths(JSON.parse(raw));
  } catch {
    return {};
  }
}

/** One pane's *stored* width, or its default. What a reload would open at —
 * `getPaneWidth` is what is on screen now. */
export function loadPaneWidth(id: PaneId): number {
  return loadPaneWidths()[id] ?? PANE_DEFAULT_PX[id];
}

// ── the live width ──────────────────────────────────────────────────────────
//
// Storage is where a width survives a reload; this is where the panes showing
// it agree on it *now*. Two of them can be on screen at once reading one id — a
// split with two diffs, or a diff beside a commit detail, all asking for
// `file-tree` — and a tree width is one preference rather than one per view, so
// the second has to hear the first one's drag rather than find out on its next
// mount (§TASK-73).
//
// Listeners are per pane id, through the same `keyed-listeners` registry
// `view-state-store` keys per field: dragging the sidebar wakes the sidebar,
// not every file tree on screen.

type PaneListener = () => void;

const live = new Map<PaneId, number>();
const listeners = createKeyedListeners<PaneId>();

/**
 * The width `id` is at, seeded from storage the first time it is asked for.
 *
 * Fit to be a `useSyncExternalStore` snapshot: it is a number, and it is the
 * same number until `setPaneWidth` says otherwise — the seed is memoised, so
 * reading it twice cannot report a change nobody made.
 */
export function getPaneWidth(id: PaneId): number {
  const current = live.get(id);
  if (current !== undefined) return current;
  const seeded = loadPaneWidth(id);
  live.set(id, seeded);
  return seeded;
}

/**
 * Move `id` now, waking only what reads it.
 *
 * Deliberately not persistence: a drag calls this per `pointermove` and writes
 * storage once, when the pointer lifts.
 */
export function setPaneWidth(id: PaneId, px: number): void {
  if (getPaneWidth(id) === px) return;
  live.set(id, px);
  listeners.notify(id);
}

/** Hear about `id` changing. Returns the unsubscribe. */
export function subscribePaneWidth(id: PaneId, listener: PaneListener): () => void {
  return listeners.subscribe(id, listener);
}

/** Test-only: how many hooks are listening to `id`, so an unmount that fails to
 * unsubscribe is a visible number rather than a slow leak. */
export function paneListenerCount(id: PaneId): number {
  return listeners.count(id);
}

/** Test-only: forget the live widths and their subscribers. Clearing
 * `localStorage` is not enough on its own — a seeded id never reads it again,
 * so one test's drag would be the next one's starting width. */
export function resetPaneWidths(): void {
  live.clear();
  listeners.clear();
}

/**
 * Write one pane's width back, leaving the others as they are.
 *
 * Read-modify-write rather than holding the record in a module variable: two
 * panes are mounted at once and each has its own hook, so a cached copy would
 * let whichever wrote last drop the other's width.
 *
 * The live value moves with it. A caller that persists without having shown
 * anything first — a width restored from elsewhere — otherwise leaves storage
 * and the screen disagreeing until the next reload.
 */
export function savePaneWidth(id: PaneId, px: number): void {
  setPaneWidth(id, px);
  const store = storage();
  if (!store) return;
  try {
    const stored = loadPaneWidths();
    // A click on a divider is a whole gesture — pointerdown, pointerup,
    // `onResizeEnd` — with no move in it, and there are two dividers on screen.
    // Nothing about the record would change, so the stringify, the write and
    // the `storage` event it wakes every other tab with are all for nothing.
    if (stored[id] === px) return;
    store.setItem(STORAGE_KEY, JSON.stringify({ ...stored, [id]: px }));
  } catch {
    // A full or blocked quota costs the user their column widths on next load,
    // which is not worth failing a render over.
  }
}

// A width dragged in another tab reaches this one.
//
// Before the live map existed every mount re-read `localStorage`, so a second
// tab picked up the first one's widths whenever a pane remounted. The map is
// what makes two panes on one id agree, and it is also what makes an id, once
// seeded, never read storage again — so without this the other tab's width
// would not land until a reload.
//
// The event fires only in *other* documents than the one that wrote, which is
// exactly the property that makes it useless to test in-process: nothing a test
// can do to `localStorage` will produce it, so the listener is verified in a
// browser or not at all. `setPaneWidth` no-ops on an unchanged width, so the
// panes whose widths the other tab did not touch are not woken.
//
// Guarded on `window` and not on `localStorage`: the test stub is installed and
// removed long after this module is evaluated, and a guard on it would be read
// once, at import, against whatever happened to be there then.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    // `key === null` is a `clear()`, which names no key and drops ours with
    // everything else — every pane goes back to its default.
    if (e.key !== null && e.key !== STORAGE_KEY) return;
    let widths: PaneWidths = {};
    try {
      widths = e.newValue ? revivePaneWidths(JSON.parse(e.newValue)) : {};
    } catch {
      // Someone else's build, or a hand-edited record. The defaults below are
      // a better answer than leaving the panes on a width no longer stored.
    }
    for (const id of Object.keys(PANE_DEFAULT_PX) as PaneId[]) {
      setPaneWidth(id, widths[id] ?? PANE_DEFAULT_PX[id]);
    }
  });
}
