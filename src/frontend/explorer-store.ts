// The Explorer panel's own chrome state (§7.1): whether the right-hand panel is
// open, and which of its four sections is showing.
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

export const EXPLORER_SECTIONS = ["Changes", "Files", "History", "Refs"] as const;

export type ExplorerSection = (typeof EXPLORER_SECTIONS)[number];

export interface ExplorerState {
  open: boolean;
  section: ExplorerSection;
}

export const EXPLORER_DEFAULT: ExplorerState = { open: true, section: "Changes" };

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

/**
 * Rebuild the panel state from whatever was stored, or return null.
 *
 * The section is checked against `EXPLORER_SECTIONS` rather than trusted as a
 * string: a build that renames or drops a section would otherwise leave the
 * rail pointing at one that no longer exists, and the panel would open onto
 * nothing with no rail item marked active to click back out of.
 */
export function reviveExplorerState(value: unknown): ExplorerState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.open !== "boolean") return null;
  if (!isExplorerSection(raw.section)) return null;
  return { open: raw.open, section: raw.section };
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
