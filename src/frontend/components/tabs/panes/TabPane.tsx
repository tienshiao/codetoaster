import { useCallback, useMemo, useRef, type ReactNode, type RefObject } from "react";
import { DiffView } from "@/frontend/DiffView";
import { useBacklogLinkProvider } from "@/frontend/hooks/use-backlog-links";
import { useFocusRequest } from "@/frontend/hooks/use-focus-request";
import { viewRef } from "@/frontend/view-state-store";
import {
  isTerminalTab,
  type OpenOptions,
  type TabDescriptor,
  type TabState,
} from "@/frontend/layout-store";
import { AgentPane } from "./AgentPane";
import { CommitPane } from "./CommitPane";
import { DiffFilePane } from "./DiffFilePane";
import { FilePane } from "./FilePane";
import { HistoryPane } from "./HistoryPane";
import { ShellPane } from "./ShellPane";

export interface TabPaneProps {
  taskId: string;
  tab: TabState;
  /** Opening a tab is the layout's business, not a pane's: a commit row here
   * and a commit row in the command palette both go through `openTab`. */
  onOpenTab: (descriptor: TabDescriptor, options?: OpenOptions) => void;
  /** Delivers a finished review to the agent. False when it could not be sent,
   * which is what keeps the user's comments from being cleared. */
  onSubmitReview: (promptText: string) => boolean;
  /** False for a terminal tab that is mounted but not showing. `TabArea` keeps
   * those mounted; every other kind only renders while it is active. */
  visible: boolean;
  /**
   * A rising number means "you are in front now — take the caret" (TASK-34).
   * Zero for every pane that is not the one the layout points at, so a pulse
   * reaches exactly one.
   *
   * A counter rather than a boolean: the same pane can be asked twice in a
   * row, by a `⌘K ]` that cycles a two-tab strip back round to it.
   */
  focusRequest?: number;
  /** A rising number is the strip's magnifier or the palette asking this tab's
   * terminal to open search (TASK-58), addressed by tab id exactly as
   * `focusRequest` is. Only the terminal kinds can answer one. */
  searchRequest?: number;
}

/**
 * What a tab shows (§7.2): one switch from a `TabDescriptor` to the component
 * that draws it.
 *
 * The view key each pane's state lives under is the tab's own key, which is the
 * point of keying `view-state-store` by tab: "which tab is this" and "whose
 * scroll offset is this" stop being two questions that can disagree.
 */
export function TabPane({
  taskId,
  tab,
  onOpenTab,
  onSubmitReview,
  visible,
  focusRequest = 0,
  searchRequest = 0,
}: TabPaneProps) {
  const view = useMemo(() => viewRef(taskId, tab.key), [taskId, tab.key]);

  // A preview open: clicking through a commit graph or a file tree replaces the
  // italic tab in place rather than leaving thirty behind. A double-click on the
  // tab pins it.
  const openCommit = useCallback(
    (sha: string) => onOpenTab({ kind: "commit", sha }, { preview: true }),
    [onOpenTab],
  );
  const openChanges = useCallback(() => onOpenTab({ kind: "diffAll" }), [onOpenTab]);

  // Go-to-definition. Permanent rather than preview: the user asked for this
  // file by name, and the next preview open would otherwise take its place.
  // The line rides on the descriptor, so jumping into a file already open
  // moves the cursor instead of opening it twice (`tabKey` ignores `line`).
  const openFile = useCallback(
    (path: string, line: number) => onOpenTab({ kind: "file", path, line }),
    [onOpenTab],
  );

  // Task ids in the task's terminals, as links to the task files (TASK-86).
  // Called unconditionally, above the switch, because the switch returns a
  // different pane per descriptor and a hook cannot live behind that.
  // Undefined outside a Backlog.md repository, which registers nothing.
  const linkProvider = useBacklogLinkProvider(taskId, visible, onOpenTab);

  // Where the caret lands for a pane that has no terminal to hand it to. A
  // chord onto a diff or a file must still take focus *from* somewhere: in a
  // split the other group's terminal keeps the caret otherwise, and every key
  // meant for this pane — DiffLayout's arrows, which stand down while a
  // textarea has focus — is typed into that PTY instead. The wrapper is
  // focusable but not tabbable, so the Tab key's order is what it was.
  // Unused by the terminal kinds, which pass the pulse to their grid.
  const frame = useRef<HTMLDivElement>(null);
  useFocusRequest(isTerminalTab(tab.descriptor) ? 0 : focusRequest, frame);

  const { descriptor } = tab;
  switch (descriptor.kind) {
    case "agent":
      return (
        <AgentPane
          taskId={taskId}
          visible={visible}
          focusRequest={focusRequest}
          searchRequest={searchRequest}
          linkProvider={linkProvider}
        />
      );

    case "shell":
      // A second PTY in the task, spawned at its cwd (§3). Named by the
      // descriptor rather than by the task, since a task has one agent and
      // however many of these.
      return (
        <ShellPane
          ptyId={descriptor.ptyId}
          visible={visible}
          focusRequest={focusRequest}
          searchRequest={searchRequest}
          linkProvider={linkProvider}
        />
      );

    case "diffAll":
      // Rendered directly rather than through a pane of its own: `DiffView`
      // already takes a task and a submit, and already addresses the `diffAll`
      // and `review` slots itself, so a wrapper would be a layer that forwards
      // two props.
      return (
        <Frame ref={frame}>
          <DiffView taskId={taskId} onSubmit={onSubmitReview} onOpenFile={openFile} />
        </Frame>
      );

    case "diff":
      return (
        <Frame ref={frame}>
          <DiffFilePane taskId={taskId} view={view} path={descriptor.path} onOpenFile={openFile} />
        </Frame>
      );

    case "file":
      return (
        <Frame ref={frame}>
          <FilePane
            taskId={taskId}
            view={view}
            path={descriptor.path}
            line={descriptor.line}
            onOpenFile={openFile}
          />
        </Frame>
      );

    case "commit":
      return (
        <Frame ref={frame}>
          <CommitPane taskId={taskId} view={view} sha={descriptor.sha} onOpenCommit={openCommit} />
        </Frame>
      );

    case "history":
      return (
        <Frame ref={frame}>
          <HistoryPane
            taskId={taskId}
            view={view}
            onOpenCommit={openCommit}
            onOpenChanges={openChanges}
          />
        </Frame>
      );
  }
}

/** The focusable box around a non-terminal pane — see `frame` above. Full
 * height, so the pane's own `h-full` root is measured against what it was. */
function Frame({ ref, children }: { ref: RefObject<HTMLDivElement | null>; children: ReactNode }) {
  return (
    <div ref={ref} tabIndex={-1} className="h-full outline-none">
      {children}
    </div>
  );
}
