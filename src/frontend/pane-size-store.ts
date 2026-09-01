// The width of every pane whose divider the user can drag (§TASK-69): the task
// sidebar, the Explorer, and the file tree the diff, file browser and commit
// detail all share.
//
// Per device and not per task, for the same reason as `explorer-store`: how
// wide a column is is a property of the monitor it is being read on, not of the
// work shown in it. One key holds all of them, so a new resizable pane costs an
// id and nothing else — and so the whole record is validated in one pass rather
// than each pane trusting its own slot.
//
// What is stored is what the user *asked for*, never what a narrow window could
// afford at the time. `use-pane-width` clamps for the render and leaves the
// stored number alone, so working on a laptop for an afternoon does not quietly
// rewrite the widths set on the monitor.

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

/** One pane's stored width, or its default. */
export function loadPaneWidth(id: PaneId): number {
  return loadPaneWidths()[id] ?? PANE_DEFAULT_PX[id];
}

/**
 * Write one pane's width back, leaving the others as they are.
 *
 * Read-modify-write rather than holding the record in a module variable: two
 * panes are mounted at once and each has its own hook, so a cached copy would
 * let whichever wrote last drop the other's width.
 */
export function savePaneWidth(id: PaneId, px: number): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify({ ...loadPaneWidths(), [id]: px }));
  } catch {
    // A full or blocked quota costs the user their column widths on next load,
    // which is not worth failing a render over.
  }
}
