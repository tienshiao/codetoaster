// The Explorer panel's own chrome state (§7.1): whether the right-hand panel is
// open, which of its five sections is showing, and the Backlog section's
// Open/Closed tab.
//
// Not keyed by task. The panel is a property of the window — a user who works
// with the Explorer shut wants it shut for every task, and one who lives in
// Refs does not want Changes back because they clicked a different row in the
// task list. That is the opposite of `layout-store`, which is per task
// precisely because what is *open* in the main area is the task's.
//
// The section labels live here rather than beside the component because the
// stored section has to be validated against them, and a list that can drift
// from the one doing the validating is the bug this file exists to prevent.

export const EXPLORER_SECTIONS = ["Changes", "Files", "History", "Refs", "Backlog"] as const;

export type ExplorerSection = (typeof EXPLORER_SECTIONS)[number];

/** The Backlog section's split (TASK-85). Open is every non-terminal status;
 * Closed is the terminal one. */
export const BACKLOG_TABS = ["Open", "Closed"] as const;

export type BacklogTab = (typeof BACKLOG_TABS)[number];

export interface ExplorerState {
  open: boolean;
  section: ExplorerSection;
  backlogTab: BacklogTab;
}

export const EXPLORER_DEFAULT: ExplorerState = {
  open: true,
  section: "Changes",
  backlogTab: "Open",
};

const STORAGE_KEY = "codetoaster:explorer";

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

export function isExplorerSection(value: unknown): value is ExplorerSection {
  return (EXPLORER_SECTIONS as readonly unknown[]).includes(value);
}

export function isBacklogTab(value: unknown): value is BacklogTab {
  return (BACKLOG_TABS as readonly unknown[]).includes(value);
}

/**
 * Rebuild the panel state from whatever was stored, or return null.
 *
 * The section is checked against `EXPLORER_SECTIONS` rather than trusted as a
 * string: a build that renames or drops a section would otherwise leave the
 * rail pointing at one that no longer exists, and the panel would open onto
 * nothing with no rail item marked active to click back out of.
 *
 * `backlogTab` is per *field*, not per state: every build before TASK-85 wrote
 * an entry without it, and rejecting the whole object over a field added later
 * would throw away the section and the open flag of everyone who upgrades. A
 * value that is not one of `BACKLOG_TABS` is the same case one release on, so
 * both take the default for that field and leave the rest standing.
 */
export function reviveExplorerState(value: unknown): ExplorerState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.open !== "boolean") return null;
  if (!isExplorerSection(raw.section)) return null;
  return {
    open: raw.open,
    section: raw.section,
    backlogTab: isBacklogTab(raw.backlogTab) ? raw.backlogTab : EXPLORER_DEFAULT.backlogTab,
  };
}

/** The stored panel state, or the default. Never throws. */
export function loadExplorerState(): ExplorerState {
  const store = storage();
  if (!store) return EXPLORER_DEFAULT;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return EXPLORER_DEFAULT;
    return reviveExplorerState(JSON.parse(raw)) ?? EXPLORER_DEFAULT;
  } catch {
    return EXPLORER_DEFAULT;
  }
}

export function saveExplorerState(state: ExplorerState): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // A full or blocked quota costs the user their section on next load, which
    // is not worth failing a render over.
  }
}
