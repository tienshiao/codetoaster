// The task sidebar's own list state (TASK-67): the filter, whether the list is
// grouped by project, whether archived rows are showing, and which groups are
// closed.
//
// It lives here rather than in `useTaskSidebar` because `/` and `/t/$slug` are
// separate route components that each render their own `TaskShell`. Navigating
// between them unmounts one and mounts the other, so anything held in a
// component's `useState` reverts the moment the user acts on what they were
// looking at — type a filter, click the task you found, and the box is empty on
// the screen you used it to reach. Lifting `TaskShell` to the root route would
// also fix that and is the wrong fix: it makes the routes own layout rather
// than addresses, which §7.3 deliberately does not do.
//
// **Three of these persist and one deliberately does not.** Grouping, the
// archived toggle and the closed groups are settings — how the user wants the
// list arranged, no more resettable than the Explorer's open section. The
// filter is a search: it survives a navigation, because that is the whole of
// the defect, but it is left out of the persisted shape so that a reload cannot
// open the app showing two of thirty tasks with the only explanation sitting in
// a text box nobody looked at. Hidden state that hides data is worse than the
// bug being fixed.
//
// Omitted from `PersistedSidebarState` rather than stripped on the way out —
// the same choice `view-state-store` makes for `hunkExpansions` — because a
// field that is not in the type cannot be put back by an accident of spreading.

export interface SidebarState {
  filter: string;
  grouped: boolean;
  showArchived: boolean;
  /** Only the groups the user has *closed*; everything else defaults open. */
  closedGroups: Record<string, boolean>;
}

type PersistedSidebarState = Omit<SidebarState, "filter">;

/** The fields `persist` writes. A patch touching none of them changes nothing
 * on disk, so it must not pay for a write. */
const PERSISTED_KEYS = ["grouped", "showArchived", "closedGroups"] as const;

export const SIDEBAR_DEFAULT: SidebarState = {
  filter: "",
  grouped: false,
  showArchived: false,
  closedGroups: {},
};

const STORAGE_KEY = "codetoaster:sidebar";

/** localStorage throws rather than no-ops in a private window with site data
 * blocked, and is simply absent under a test runner — neither is a reason for
 * the sidebar to fail to render. */
function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Rebuild whatever of the stored settings is usable, field by field.
 *
 * Per field and not all-or-nothing, so a record written by a build that had one
 * fewer setting — or one whose single malformed entry would otherwise condemn
 * the rest — still hands back the two the user did set.
 */
export function reviveSidebarState(value: unknown): Partial<PersistedSidebarState> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const out: Partial<PersistedSidebarState> = {};
  if (typeof raw.grouped === "boolean") out.grouped = raw.grouped;
  if (typeof raw.showArchived === "boolean") out.showArchived = raw.showArchived;
  if (raw.closedGroups && typeof raw.closedGroups === "object" && !Array.isArray(raw.closedGroups)) {
    const closed: Record<string, boolean> = {};
    // Only the `true` entries, which is what the field means. An open group is
    // the default, so writing one down would grow the record on every toggle
    // and store a preference identical to having none.
    for (const [id, isClosed] of Object.entries(raw.closedGroups as Record<string, unknown>)) {
      if (isClosed === true) closed[id] = true;
    }
    out.closedGroups = closed;
  }
  return out;
}

function loadPersisted(): Partial<PersistedSidebarState> {
  const store = storage();
  if (!store) return {};
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return {};
    return reviveSidebarState(JSON.parse(raw));
  } catch {
    return {};
  }
}

function persist(state: SidebarState): void {
  const store = storage();
  if (!store) return;
  const closedGroups: Record<string, boolean> = {};
  for (const [id, isClosed] of Object.entries(state.closedGroups)) {
    if (isClosed) closedGroups[id] = true;
  }
  try {
    store.setItem(
      STORAGE_KEY,
      JSON.stringify({ grouped: state.grouped, showArchived: state.showArchived, closedGroups }),
    );
  } catch {
    // A full or blocked quota costs the user their list settings on next load,
    // which is not worth failing a render over.
  }
}

// The value, not a copy of it. One `TaskShell` is mounted at a time — `/` and
// `/t/$slug` swap, they do not coexist — so this needs no subscriber list; what
// it needs is to outlive the component, which a module binding does.
let current: SidebarState | null = null;

/** The current state, hydrating from storage on first use. Never throws. */
export function getSidebarState(): SidebarState {
  current ??= { ...SIDEBAR_DEFAULT, ...loadPersisted() };
  return current;
}

/**
 * Merge a patch in and hand back the result.
 *
 * Against the store and never against a value a render closed over, which is
 * the bug `use-explorer-panel` needs a ref to dodge: two setters called from
 * one event would each spread the same pre-event state, and the second would
 * silently undo the first.
 *
 * Written down only when the patch touches something that is written down. The
 * filter is not, and it is patched on every keystroke — so an unconditional
 * write is a `JSON.stringify` and a synchronous `setItem` per character, for
 * bytes identical to the ones already there.
 */
export function patchSidebarState(patch: Partial<SidebarState>): SidebarState {
  const next = { ...getSidebarState(), ...patch };
  current = next;
  if (PERSISTED_KEYS.some((key) => key in patch)) persist(next);
  return next;
}

/**
 * Flip one of the boolean settings.
 *
 * Read from the store rather than negated by the caller, for the reason above:
 * a component negates the value its own render closed over, so two toggles
 * batched into one event both compute the same answer and the second is a
 * no-op instead of putting the setting back.
 */
export function toggleSidebarFlag(key: "grouped" | "showArchived"): SidebarState {
  return patchSidebarState({ [key]: !getSidebarState()[key] });
}

/**
 * Open or close one group.
 *
 * Its own function rather than a `closedGroups` patch assembled by the caller,
 * so the record being spread is always the live one. A stale group id — a
 * project deleted since it was closed — is simply never asked about: the list
 * is drawn from the groups that exist, and this record is only ever read by id.
 */
export function toggleSidebarGroup(id: string): SidebarState {
  const closedGroups = { ...getSidebarState().closedGroups };
  if (closedGroups[id]) delete closedGroups[id];
  else closedGroups[id] = true;
  return patchSidebarState({ closedGroups });
}

/** Drop everything, including the hydrated copy. For tests. */
export function resetSidebarState(): void {
  current = null;
  const store = storage();
  try {
    store?.removeItem(STORAGE_KEY);
  } catch {
    // Same as `persist`: nothing here is worth throwing over.
  }
}
