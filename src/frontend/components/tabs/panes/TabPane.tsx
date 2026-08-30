import { useCallback, useMemo, type ReactNode } from "react";
import { DiffView } from "@/frontend/DiffView";
import { viewRef } from "@/frontend/view-state-store";
import type { OpenOptions, TabDescriptor, TabState } from "@/frontend/layout-store";
import { CommitPane } from "./CommitPane";
import { DiffFilePane } from "./DiffFilePane";
import { FilePane } from "./FilePane";
import { HistoryPane } from "./HistoryPane";

export interface TabPaneProps {
  taskId: string;
  tab: TabState;
  /** Opening a tab is the layout's business, not a pane's: a commit row here
   * and a commit row in the command palette both go through `openTab`. */
  onOpenTab: (descriptor: TabDescriptor, options?: OpenOptions) => void;
  /** Delivers a finished review to the agent. False when it could not be sent,
   * which is what keeps the user's comments from being cleared. */
  onSubmitReview: (promptText: string) => boolean;
  /** The terminal tabs. Their host — which PTY a tab is attached to, and when
   * to attach — is TASK-27/28's, so this pane does not invent one. */
  renderTerminal: (tab: TabState) => ReactNode;
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
  renderTerminal,
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

  const { descriptor } = tab;
  switch (descriptor.kind) {
    case "agent":
    case "shell":
      return renderTerminal(tab);

    case "diffAll":
      // Rendered directly rather than through a pane of its own: `DiffView`
      // already takes a task and a submit, and already addresses the `diffAll`
      // and `review` slots itself, so a wrapper would be a layer that forwards
      // two props.
      return <DiffView sessionId={taskId} onSubmit={onSubmitReview} />;

    case "diff":
      return <DiffFilePane taskId={taskId} view={view} path={descriptor.path} />;

    case "file":
      return (
        <FilePane taskId={taskId} view={view} path={descriptor.path} line={descriptor.line} />
      );

    case "commit":
      return (
        <CommitPane taskId={taskId} view={view} sha={descriptor.sha} onOpenCommit={openCommit} />
      );

    case "history":
      return (
        <HistoryPane
          taskId={taskId}
          view={view}
          onOpenCommit={openCommit}
          onOpenChanges={openChanges}
        />
      );
  }
}
