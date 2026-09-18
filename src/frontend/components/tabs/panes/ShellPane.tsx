import { useCallback, useEffect, useRef } from "react";
import { usePty } from "@/frontend/PtyContext";
import {
  XTerminal,
  type TerminalHandle,
  type TerminalLinkProviderFactory,
  type TerminalSize,
} from "@/frontend/Terminal";
import { useFocusRequest } from "@/frontend/hooks/use-focus-request";
import { TerminalDropFailure, useTerminalDrop } from "./use-terminal-drop";
import { useTerminalSearch } from "@/frontend/hooks/use-terminal-search";
import { TerminalSearchBar } from "./TerminalSearchBar";

export interface ShellPaneProps {
  /** The task the shell belongs to — what a dropped file's upload is scoped
   * under, since the route that stages it is the task's (TASK-96). */
  taskId: string;
  /** The PTY this tab was opened onto. Unlike the agent's, it is named by the
   * tab itself: a task has one agent and however many shells, so the descriptor
   * is the only thing that knows which of them this is. */
  ptyId: string;
  visible: boolean;
  /** A rising number is the keyboard asking this terminal to take the caret
   * (TASK-34), as on `AgentPane`. */
  focusRequest?: number;
  /** A rising number is the strip or the palette asking this pane to open
   * search — the keyboard's ⌘F arrives by the other door, `onSearchOpen`
   * (TASK-58). */
  searchRequest?: number;
  /** Whether this pane's group is the layout's active one, as on `AgentPane`:
   * only its search bar answers a ⌘G typed outside every terminal. */
  active?: boolean;
  /** Extra links in the grid — task ids, in a Backlog.md repository (TASK-86).
   * A shell tab gets the same ones the agent does: it runs the same CLI in the
   * same repository, and prints the same ids. */
  linkProviders?: readonly TerminalLinkProviderFactory[];
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
  taskId,
  ptyId,
  visible,
  focusRequest = 0,
  searchRequest = 0,
  active = false,
  linkProviders,
}: ShellPaneProps) {
  const { attach, detach, resize, send, isConnected } = usePty();
  const drop = useTerminalDrop(taskId, ptyId);
  const terminalRef = useRef<TerminalHandle>(null);
  useFocusRequest(focusRequest, terminalRef);
  /** How the search bar tells a ⌘G typed in this pane from one typed elsewhere,
   * so a split's two bars step their own matches — see `TerminalSearchBar`. */
  const root = useRef<HTMLDivElement>(null);
  const search = useTerminalSearch(terminalRef, searchRequest);
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

  // Read from the ref during render, which is only safe because `open` can
  // become true no earlier than an event after mount — by then the terminal is
  // there and its addon with it.
  const searchAddon = search.open ? terminalRef.current?.getSearchAddon() : null;

  return (
    // Wrapped only so the search overlay has something to be positioned
    // against, and so a ⌘G has a root to be measured against that is this pane's
    // alone. `data-terminal-pane` marks the subtree as a terminal's, which is
    // how a bar tells "the caret is in another terminal" from "the caret is in
    // no terminal at all" — see `TerminalSearchBar`.
    <div ref={root} data-terminal-pane className="relative h-full">
      <XTerminal
        ref={terminalRef}
        ptyId={ptyId}
        onSizeChange={handleSizeChange}
        sendMessage={send}
        onSearchOpen={search.openSearch}
        searchOpen={search.open}
        onFileDrop={drop.onFileDrop}
        linkProviders={linkProviders}
      />
      {searchAddon ? (
        <TerminalSearchBar
          searchAddon={searchAddon}
          onClose={search.closeSearch}
          activation={search.activation}
          scope={root}
          active={active}
        />
      ) : null}
      {drop.failure ? (
        <TerminalDropFailure failure={drop.failure} onDismiss={drop.dismiss} />
      ) : null}
    </div>
  );
}
