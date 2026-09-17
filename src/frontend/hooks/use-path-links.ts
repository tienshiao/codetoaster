import { useCallback, useMemo, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import type { TerminalLinkProviderFactory } from "../Terminal";
import type { PointMenuProps } from "../components/v2/DropdownMenu";
import type { OpenOptions, TabDescriptor } from "../layout-store";
import { useTasks } from "../TaskContext";
import { createPathLinkProvider, indexFiles, type PathLinkContext } from "../utils/path-links";
import { useTaskFiles } from "./use-task-files";

export interface PathLinks {
  /** Undefined until the task's file list has arrived. */
  provider: TerminalLinkProviderFactory | undefined;
  /** The chooser for a name several files share, for the pane to render as a
   * `PointMenu`. Closed (`at: null`) until such a link is clicked. */
  menu: PointMenuProps;
}

/** Permanent, like a task-id link: the user asked for this file by name. The
 * line rides on the descriptor, so a file already open moves to it rather than
 * opening twice. */
function fileTab(path: string, line: number | undefined): TabDescriptor {
  return line != null ? { kind: "file", path, line } : { kind: "file", path };
}

interface Choice {
  paths: string[];
  line: number | undefined;
  at: { x: number; y: number };
}

/**
 * The link provider for file paths in a task's terminals (TASK-108), and the
 * menu that goes with it (TASK-109).
 *
 * The provider is undefined until the task's file list has arrived — a task
 * outside any repository never gets one, since its list is an error.
 *
 * The list is the Explorer's query, shared by key, so a task whose Files
 * section has already loaded costs nothing more, and a change to the working
 * tree refreshes both (TASK-103). No poll of its own: the invalidation is
 * what keeps it current.
 *
 * `enabled` is false for a pane with no terminal on screen: a hidden terminal
 * tab, or a diff or file tab that has no grid at all. Such a pane is then no
 * active observer, so a burst of working-tree changes does not refetch the
 * whole listing on its account (TASK-103 AC #6). Cached data is still read, so
 * a hidden terminal keeps its links, and showing it refetches if stale.
 *
 * A link that names one file opens it. One that could be several — a bare
 * `index.ts` — opens `menu` at the click, listing them best first, and the
 * chosen one opens exactly as a single match would have.
 */
export function usePathLinkProvider(
  taskId: string,
  enabled: boolean,
  onOpenTab: (descriptor: TabDescriptor, options?: OpenOptions) => void,
): PathLinks {
  const { data } = useTaskFiles(taskId, { enabled });
  // The agent's live cwd. A shell tab's own cwd is not something the client
  // knows, so it shares this one; the root is tried after it either way.
  const cwd = useTasks().taskById(taskId)?.cwd ?? null;

  const index = useMemo(() => indexFiles(data), [data]);
  // Through refs, as in `useBacklogLinkProvider`: the factory's identity is
  // what `XTerminal` keys its registration on, so a refetched list or a moved
  // cwd must reach the provider without reaching the memo below.
  const contextRef = useRef<PathLinkContext | null>(null);
  contextRef.current = index ? { index, cwd } : null;
  const onOpenTabRef = useRef(onOpenTab);
  onOpenTabRef.current = onOpenTab;

  const [choice, setChoice] = useState<Choice | null>(null);

  const ready = index != null;
  const provider = useMemo(() => {
    if (!ready) return undefined;
    return (terminal: Terminal) =>
      createPathLinkProvider(
        terminal,
        () => contextRef.current,
        (paths, line, event) => {
          if (paths.length === 1) onOpenTabRef.current(fileTab(paths[0]!, line));
          else setChoice({ paths, line, at: { x: event.clientX, y: event.clientY } });
        },
      );
  }, [ready]);

  const dismiss = useCallback(() => setChoice(null), []);
  const menu = useMemo<PointMenuProps>(
    () => ({
      at: choice?.at ?? null,
      onDismiss: dismiss,
      "aria-label": "Open file",
      items: (choice?.paths ?? []).map((path) => ({
        label: path,
        mono: true,
        onSelect: () => onOpenTabRef.current(fileTab(path, choice?.line)),
      })),
    }),
    [choice, dismiss],
  );

  return { provider, menu };
}
