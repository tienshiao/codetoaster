import { useCallback, useRef, useState } from "react";
import {
  isExplorerSection,
  loadExplorerState,
  saveExplorerState,
  type BacklogTab,
  type ExplorerSection,
  type ExplorerState,
} from "@/frontend/explorer-store";

export interface ExplorerPanel {
  open: boolean;
  section: ExplorerSection;
  /** The Backlog section's split (TASK-85), remembered per device alongside the
   * section so reopening the panel lands where it was left. */
  backlogTab: BacklogTab;
  setOpen: (open: boolean) => void;
  /** Takes a plain string because it is fed straight from the rail, which
   * names sections by label. An unknown label is ignored. */
  setSection: (label: string) => void;
  setBacklogTab: (tab: BacklogTab) => void;
}

/**
 * The Explorer panel's open/section state, written through to localStorage.
 *
 * Read during render rather than in an effect, like `useTaskLayout`: a stored
 * section that arrives one frame late means the panel paints Changes and then
 * swaps, and there is nothing to wait for — the read is synchronous.
 */
export function useExplorerPanel(): ExplorerPanel {
  const [state, setState] = useState<ExplorerState>(loadExplorerState);

  // Patches apply to this, not to the value the render closed over. One rail
  // click on a section other than the open one calls both setters — open the
  // panel, then switch section — and each would otherwise spread the same
  // pre-click state, so the second silently undid the first and the panel
  // stayed shut.
  const latest = useRef(state);

  const update = useCallback((patch: Partial<ExplorerState>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    saveExplorerState(next);
    setState(next);
  }, []);

  const setOpen = useCallback((open: boolean) => update({ open }), [update]);

  const setSection = useCallback(
    (label: string) => {
      if (!isExplorerSection(label)) return;
      update({ section: label });
    },
    [update],
  );

  // Through the same `update`, so the tab is written with whatever the panel's
  // open flag and section are *now* rather than with the render's snapshot.
  const setBacklogTab = useCallback((backlogTab: BacklogTab) => update({ backlogTab }), [update]);

  return {
    open: state.open,
    section: state.section,
    backlogTab: state.backlogTab,
    setOpen,
    setSection,
    setBacklogTab,
  };
}
