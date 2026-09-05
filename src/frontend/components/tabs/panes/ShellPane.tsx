import { useCallback, useEffect, useRef } from "react";
import { usePty } from "@/frontend/PtyContext";
import {
  XTerminal,
  type TerminalHandle,
  type TerminalLinkProviderFactory,
  type TerminalSize,
} from "@/frontend/Terminal";

export interface ShellPaneProps {
  /** The PTY this tab was opened onto. Unlike the agent's, it is named by the
   * tab itself: a task has one agent and however many shells, so the descriptor
   * is the only thing that knows which of them this is. */
  ptyId: string;
  visible: boolean;
  /** A rising number is the keyboard asking this terminal to take the caret
   * (TASK-34), as on `AgentPane`. */
  focusRequest?: number;
  onSearchOpen?: () => void;
  /** Extra links in the grid — task ids, in a Backlog.md repository (TASK-86).
   * A shell tab gets the same one the agent does: it runs the same CLI in the
   * same repository, and prints the same ids. */
  linkProvider?: TerminalLinkProviderFactory;
}

/**
 * A plain shell in the task's directory (§3), as a sibling tab of the agent.
 *
 * `AgentPane` without the hard part. There is no reopen here and there never
 * will be: a shell is not resumable — no snapshot is taken of it, and nothing
 * knows what the user was doing in it — so a shell whose PTY is gone is a tab
 * with nothing behind it rather than a task waiting to be woken. That case is
 * handled a layer up, where the layout is, by `pruneShellTabs`.
 *
 * What is left is the part every terminal tab shares: attach while mounted,
 * report the grid while visible, stop reporting while hidden so a background
 * tab's stale layout does not hold the PTY down through smallest-wins (§5.4).
 *
 * A shell that exits on its own keeps its tab, showing the `[Process exited
 * with code N]` the grid has already written — the same thing an agent whose
 * process died does. `PtyManager` only forgets a PTY when something kills it,
 * so the task goes on reporting this one and the reconciliation leaves it
 * alone; closing the tab is what reaps it. Dropping the tab on the exit frame
 * would take the exit code down with it, which is the one place the reason a
 * shell died is written.
 */
export function ShellPane({
  ptyId,
  visible,
  focusRequest = 0,
  onSearchOpen,
  linkProvider,
}: ShellPaneProps) {
  const { attach, detach, resize, send, isConnected } = usePty();
  const terminalRef = useRef<TerminalHandle>(null);

  // Zero is "not you": every pane the pulse is not addressed to holds it, so a
  // pulse reaches exactly one terminal — and only on a rise from what this pane
  // mounted with, as on `AgentPane`.
  const seenFocusRequest = useRef(focusRequest);
  useEffect(() => {
    if (focusRequest && focusRequest !== seenFocusRequest.current) terminalRef.current?.focus();
    seenFocusRequest.current = focusRequest;
  }, [focusRequest]);
  /** The last grid measured against a *visible* container; never fabricated. */
  const sizeRef = useRef<TerminalSize | null>(null);

  // Keyed on the connection as well as the PTY: a reconnect clears every
  // attachment the client held, while the ptyId survives it, so without
  // `isConnected` this terminal would be the one that never came back.
  useEffect(() => {
    if (!isConnected) return;
    terminalRef.current?.resetAttached();
    attach(ptyId, sizeRef.current);
    return () => detach(ptyId);
  }, [ptyId, isConnected, attach, detach]);

  useEffect(() => {
    if (!visible) {
      resize(ptyId, null);
    } else if (sizeRef.current) {
      // Re-reported on the way back rather than left to the resize observer,
      // which only fires on an actual geometry change — and a tab very often
      // returns at exactly the size it left at.
      resize(ptyId, sizeRef.current);
    }
  }, [ptyId, visible, resize]);

  const handleSizeChange = useCallback(
    (size: TerminalSize) => {
      sizeRef.current = size;
      resize(ptyId, size);
    },
    [ptyId, resize],
  );

  return (
    <XTerminal
      ref={terminalRef}
      ptyId={ptyId}
      onSizeChange={handleSizeChange}
      sendMessage={send}
      onSearchOpen={onSearchOpen}
      linkProvider={linkProvider}
    />
  );
}
