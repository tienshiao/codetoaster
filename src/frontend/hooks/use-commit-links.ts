import { useMemo, useRef } from "react";
import type { Terminal } from "@xterm/xterm";
import type { TerminalLinkProviderFactory } from "../Terminal";
import type { OpenOptions, TabDescriptor } from "../layout-store";
import { createCommitLinkProvider, createCommitResolver, fetchCommits } from "../utils/commit-links";

/**
 * The link provider for commit hashes in a task's terminals (TASK-110).
 *
 * Unlike the other two this is never undefined, because there is nothing to
 * wait for: it needs no index, so it works from the first frame a terminal
 * paints, and a task in no repository simply resolves nothing. The factory's
 * identity changes only with the task, so the grid is registered once — and the
 * resolver's memory of what is and is not a commit lives exactly as long as
 * that registration.
 */
export function useCommitLinkProvider(
  taskId: string,
  onOpenTab: (descriptor: TabDescriptor, options?: OpenOptions) => void,
): TerminalLinkProviderFactory {
  const onOpenTabRef = useRef(onOpenTab);
  onOpenTabRef.current = onOpenTab;

  const resolve = useMemo(
    () => createCommitResolver((shas) => fetchCommits(taskId, shas)),
    [taskId],
  );

  return useMemo(
    () => (terminal: Terminal) =>
      createCommitLinkProvider(terminal, resolve, (sha) =>
        // Permanent rather than preview, as the other two links are: clicking a
        // hash is the user asking for that commit, and a preview tab would be
        // taken by the next one. The full sha keys the tab, so a commit clicked
        // twice — abbreviated in one line, whole in another — is one tab.
        onOpenTabRef.current({ kind: "commit", sha }),
      ),
    [resolve],
  );
}
