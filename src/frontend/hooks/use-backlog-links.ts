import { useMemo, useRef } from "react";
import type { Terminal } from "@xterm/xterm";
import type { TerminalLinkProviderFactory } from "../Terminal";
import type { OpenOptions, TabDescriptor } from "../layout-store";
import { createBacklogLinkProvider, indexBacklog } from "../utils/backlog-links";
import { useBacklog } from "./use-backlog";

/**
 * The link provider a task's terminals hand to `XTerminal` (TASK-86), or
 * undefined outside a Backlog.md repository — where nothing is registered at
 * all (AC #3).
 *
 * The poll follows visibility rather than mounting: a terminal tab stays
 * mounted while another tab is showing, so an invisible one would otherwise go
 * on asking every fifteen seconds for a list nobody can see. Nothing is lost by
 * stopping — `useBacklog` is one query key for every consumer, so the
 * Explorer's own poll refreshes this cache too, and coming back into view
 * refetches.
 */
export function useBacklogLinkProvider(
  taskId: string,
  visible: boolean,
  onOpenTab: (descriptor: TabDescriptor, options?: OpenOptions) => void,
): TerminalLinkProviderFactory | undefined {
  const { data } = useBacklog(taskId, { refetchInterval: visible ? 15_000 : false });

  const index = useMemo(() => indexBacklog(data), [data]);
  // Both read through refs, and for the same reason: the factory's identity is
  // what `XTerminal` keys its registration on, so anything that changes per
  // poll or per render must not reach the memo below. The provider asks for the
  // current index every time it is called instead.
  const indexRef = useRef(index);
  indexRef.current = index;
  const onOpenTabRef = useRef(onOpenTab);
  onOpenTabRef.current = onOpenTab;

  const detected = index != null;
  return useMemo(
    () =>
      detected
        ? (terminal: Terminal) =>
            createBacklogLinkProvider(
              terminal,
              () => indexRef.current,
              // Permanent, not preview: following a link is the user asking for
              // that file by name, which is the convention `TaskShell`'s `?tab=`
              // handling documents. `openTab` focuses the tab if the file is
              // already open, so clicking the same id twice does not open it
              // twice.
              (path) => onOpenTabRef.current({ kind: "file", path }),
            )
        : undefined,
    // Only whether this is a Backlog.md repository at all. A poll that adds a
    // task must not re-register the provider — it reads the new list through
    // the ref — so the identity changes once, when detection flips.
    [detected],
  );
}
