import { useCallback, useMemo, useState, type MouseEvent } from "react";
import { FolderSearch } from "lucide-react";
import { toast } from "sonner";
import { rootId, type RepoRoot } from "@/frontend/repo-root";
import { revealFile } from "@/frontend/hooks/use-task-files";
import { canRevealInFinder } from "@/frontend/utils/platform";
import type { PointMenuProps } from "@/frontend/components/v2/DropdownMenu";

/**
 * Show in Finder for a path under `root` (TASK-120, TASK-131), or undefined
 * where it has no business being offered.
 *
 * The daemon reveals the path on its own machine, so the affordance is only
 * for a browser that is plausibly sitting at it — `canRevealInFinder`. Every
 * surface takes the absence as "draw nothing", which is what keeps the gate in
 * one place. A failure is said here for the same reason.
 */
export function useRevealInFinder(root: RepoRoot): ((path: string) => void) | undefined {
  const rootKey = rootId(root);
  return useMemo(() => {
    if (!canRevealInFinder()) return undefined;
    return (path: string) => {
      revealFile(root, path).catch((e: Error) =>
        toast.error(`Could not show ${path} in Finder`, { description: e.message }),
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `root` by its key: a new object for the same root is not a new root
  }, [rootKey]);
}

export interface RevealMenu {
  /** A row's right-click: opens the menu at the pointer, for that row's path.
   * Absent where Finder cannot be shown, so the browser's own menu is left to
   * open as it would on any other page. */
  onContextMenu?: (event: MouseEvent, path: string) => void;
  /** For a `PointMenu`, mounted once beside the rows. Closed (`at: null`)
   * until a row is right-clicked. */
  menu: PointMenuProps;
}

/**
 * The right-click menu of an Explorer row (TASK-131): Show in Finder, for a
 * file, a directory or a Backlog task's file, without opening its tab first.
 *
 * One menu per list rather than one per row. A tree can hold thousands of
 * rows, and a Radix root around each is a cost every one of them pays for a
 * menu at most one is showing.
 */
export function useRevealMenu(root: RepoRoot): RevealMenu {
  const reveal = useRevealInFinder(root);
  const rootKey = rootId(root);
  const [target, setTarget] = useState<{
    rootKey: string;
    path: string;
    at: { x: number; y: number };
  } | null>(null);
  // A path is its root's. The sections are not remounted per root, and a chord
  // can move the shell to another task with the menu still up: it closes then,
  // rather than offering to show the old task's path in the new one's tree.
  if (target && target.rootKey !== rootKey) setTarget(null);

  const onContextMenu = useMemo(() => {
    if (!reveal) return undefined;
    return (event: MouseEvent, path: string) => {
      event.preventDefault();
      setTarget({ rootKey, path, at: { x: event.clientX, y: event.clientY } });
    };
  }, [reveal, rootKey]);

  const dismiss = useCallback(() => setTarget(null), []);
  const menu = useMemo<PointMenuProps>(
    () => ({
      at: target?.at ?? null,
      onDismiss: dismiss,
      "aria-label": target?.path,
      items:
        target && reveal
          ? [{ label: "Show in Finder", icon: FolderSearch, onSelect: () => reveal(target.path) }]
          : [],
    }),
    [target, reveal, dismiss],
  );

  return { onContextMenu, menu };
}
