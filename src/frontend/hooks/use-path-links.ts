import { useMemo, useRef } from "react";
import type { Terminal } from "@xterm/xterm";
import type { TerminalLinkProviderFactory } from "../Terminal";
import type { OpenOptions, TabDescriptor } from "../layout-store";
import { useTasks } from "../TaskContext";
import { createPathLinkProvider, indexFiles, type PathLinkContext } from "../utils/path-links";
import { useTaskFiles } from "./use-task-files";

/**
 * The link provider for file paths in a task's terminals (TASK-108), or
 * undefined until the task's file list has arrived — a task outside any
 * repository never gets one, since its list is an error.
 *
 * The list is the Explorer's query, shared by key, so a task whose Files
 * section has already loaded costs nothing more, and a change to the working
 * tree refreshes both (TASK-103). No poll of its own: the invalidation is
 * what keeps it current.
 */
export function usePathLinkProvider(
  taskId: string,
  onOpenTab: (descriptor: TabDescriptor, options?: OpenOptions) => void,
): TerminalLinkProviderFactory | undefined {
  const { data } = useTaskFiles(taskId);
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

  const ready = index != null;
  return useMemo(
    () =>
      ready
        ? (terminal: Terminal) =>
            createPathLinkProvider(
              terminal,
              () => contextRef.current,
              // Permanent, like a task-id link: the user asked for this file by
              // name. The line rides on the descriptor, so a file already open
              // moves to it rather than opening twice.
              (path, line) =>
                onOpenTabRef.current(
                  line != null ? { kind: "file", path, line } : { kind: "file", path },
                ),
            )
        : undefined,
    [ready],
  );
}
