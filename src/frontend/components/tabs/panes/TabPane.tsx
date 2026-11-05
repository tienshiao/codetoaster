import { useCallback, useMemo, useRef, type ReactNode, type RefObject } from "react";
import { DiffView } from "@/frontend/DiffView";
import { useBacklogLinkProvider } from "@/frontend/hooks/use-backlog-links";
import { useCommitLinkProvider } from "@/frontend/hooks/use-commit-links";
import { useFocusRequest } from "@/frontend/hooks/use-focus-request";
import { usePathLinkProvider } from "@/frontend/hooks/use-path-links";
import { PointMenu } from "@/frontend/components/v2/DropdownMenu";
import { viewRef } from "@/frontend/view-state-store";
import { rootId, worktreeRoot, type RepoRoot } from "@/frontend/repo-root";
import {
  descriptorWorktree,
  isTerminalTab,
  withWorktree,
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
import { WorktreeFrame } from "./WorktreeFrame";

export interface TabPaneProps {
  /** What the pane reads: a task's checkout, or — at the composer (TASK-106) —
   * a project's directory, which has no terminal to show. */
  root: RepoRoot;
  /** What the `agent` tab shows when the root is not a task — the composer.
   * A project has no agent yet; the tab is where the prompt that will start
   * one is written. Ignored for a task root. */
  agentContent?: ReactNode;
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
  /** The task's route, `/t/<slug>`, which a file tab's markdown links build
   * real URLs on (TASK-126). Absent for a project root, which has no route
   * that opens tabs. */
  taskHref?: string;
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
  /** Whether this pane's group is the layout's active group — the one the
   * leader chords act on. A terminal's search bar answers ⌘G on this when the
   * caret is in no terminal at all (the Explorer, the strip), so a split's two
   * bars still step one terminal's matches rather than both. */
  active?: boolean;
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
  root,
  agentContent,
  tab,
  onOpenTab,
  onSubmitReview,
  visible,
  taskHref,
  focusRequest = 0,
  searchRequest = 0,
  active = false,
}: TabPaneProps) {
  // Only a task has terminals; the agent and shell kinds need one, and the
  // link providers below are a terminal's.
  const taskId = root.kind === "task" ? root.id : null;
  const id = rootId(root);
  // The slot stays the task's: the tab key carries the worktree, and keeping
  // the task's root id is what lets closing the tab prune its state.
  const view = useMemo(() => viewRef(id, tab.key), [id, tab.key]);

  // A working-tree tab on another worktree reads that worktree (TASK-138.2),
  // and whatever it opens — View file, Show changes, a markdown link — opens
  // on the same worktree.
  const worktree = descriptorWorktree(tab.descriptor);
  const paneRoot = useMemo(() => (worktree ? worktreeRoot(root, worktree) : root), [root, worktree]);
  const open = useCallback(
    (descriptor: TabDescriptor, options?: OpenOptions) =>
      onOpenTab(withWorktree(descriptor, worktree), options),
    [onOpenTab, worktree],
  );

  // A preview open: clicking through a commit graph or a file tree replaces the
  // italic tab in place rather than leaving thirty behind. A double-click on the
  // tab pins it.
  const openCommit = useCallback(
    (sha: string) => onOpenTab({ kind: "commit", sha }, { preview: true }),
    [onOpenTab],
  );
  const openChanges = useCallback(() => open({ kind: "diffAll" }), [open]);

  // Go-to-definition. Permanent rather than preview: the user asked for this
  // file by name, and the next preview open would otherwise take its place.
  // The line rides on the descriptor, so jumping into a file already open
  // moves the cursor instead of opening it twice (`tabKey` ignores `line`).
  // A markdown link's heading rides the same way (TASK-124), stamped so that
  // following the same link again is a new request the tab will act on.
  const openFile = useCallback(
    (path: string, line?: number, anchor?: string) =>
      open(
        anchor ? { kind: "file", path, line, anchor, anchorAt: Date.now() } : { kind: "file", path, line },
      ),
    [open],
  );
  // A file tab's Show changes (TASK-121), the way back from a diff's View file.
  // Permanent for the same reason: asked for by name, and `tabKey` dedupes, so
  // going back and forth switches between two tabs rather than making more.
  const openDiff = useCallback((path: string) => open({ kind: "diff", path }), [open]);

  // Task ids (TASK-86), file paths (TASK-108) and commit hashes (TASK-110) in
  // the task's terminals, as links that open a tab. Called unconditionally,
  // above the switch, because the switch returns a different pane per
  // descriptor and a hook cannot live behind that. The first two are undefined
  // when they have nothing to match against; the third needs no index and is
  // there for every task. All three are undefined for a project root, which
  // has no terminal. Memoised on the factories, whose identities change only
  // when one appears or goes, so the grid is not re-registered per render.
  const backlogLinks = useBacklogLinkProvider(taskId, visible, onOpenTab);
  const pathLinks = usePathLinkProvider(
    taskId,
    visible && isTerminalTab(tab.descriptor),
    onOpenTab,
  );
  const commitLinks = useCommitLinkProvider(taskId, onOpenTab);
  // Registered as three, not folded into one, and last is where the commit
  // provider belongs: it is the only one that may have to ask the server, and
  // xterm lets each provider claim a link the moment the ones before it have
  // come back empty. So the two that answer from an index they already hold are
  // captured on `mousedown` whatever the third is waiting for — see
  // `XTerminal`'s `linkProviders`. The absent ones drop out, and with all three
  // absent nothing is registered.
  const linkProviders = useMemo(
    () => [backlogLinks, pathLinks.provider, commitLinks].filter((p) => p != null),
    [backlogLinks, pathLinks.provider, commitLinks],
  );
  // A name several files share opens this at the click (TASK-109). Portalled,
  // so it sits beside the grid without entering the pane's layout.
  const fileChooser = <PointMenu {...pathLinks.menu} />;

  // Where the caret lands for a pane that has no terminal to hand it to. A
  // chord onto a diff or a file must still take focus *from* somewhere: in a
  // split the other group's terminal keeps the caret otherwise, and every key
  // meant for this pane — DiffLayout's arrows, which stand down while a
  // textarea has focus — is typed into that PTY instead. The wrapper is
  // focusable but not tabbable, so the Tab key's order is what it was.
  // Unused by the terminal kinds, which pass the pulse to their grid.
  //
  // A terminal kind with no task behind it — the composer in a project root's
  // agent tab — has no grid to hand the pulse to, so the frame takes it: a
  // chord onto that tab lands the caret on the composer's side of the screen
  // rather than leaving it wherever it was.
  const frame = useRef<HTMLDivElement>(null);
  const terminal = isTerminalTab(tab.descriptor) && taskId !== null;
  useFocusRequest(terminal ? 0 : focusRequest, frame);

  const { descriptor } = tab;
  switch (descriptor.kind) {
    case "agent":
      // A project root's agent tab is the composer (TASK-106): there is no
      // agent until the prompt written there starts one.
      if (taskId === null) return <Frame ref={frame}>{agentContent ?? null}</Frame>;
      return (
        <>
          <AgentPane
            taskId={taskId}
            visible={visible}
            focusRequest={focusRequest}
            searchRequest={searchRequest}
            active={active}
            linkProviders={linkProviders}
          />
          {fileChooser}
        </>
      );

    case "shell":
      // A second PTY in the task, spawned at its cwd (§3). Named by the
      // descriptor rather than by the task, since a task has one agent and
      // however many of these. Cannot arise without a task: the `+` that opens
      // one is withheld from a project root.
      if (taskId === null) return null;
      return (
        <>
          <ShellPane
            taskId={taskId}
            ptyId={descriptor.ptyId}
            visible={visible}
            focusRequest={focusRequest}
            searchRequest={searchRequest}
            active={active}
            linkProviders={linkProviders}
          />
          {fileChooser}
        </>
      );

    case "diffAll":
      // Rendered directly rather than through a pane of its own: `DiffView`
      // already takes a task and a submit, and already addresses the `diffAll`
      // and `review` slots itself, so a wrapper would be a layer that forwards
      // two props.
      return (
        <Frame ref={frame}>
          <OnWorktree root={root} worktree={worktree}>
            <DiffView
              root={paneRoot}
              onSubmit={onSubmitReview}
              onOpenFile={openFile}
              // At the composer a review is appended to the prompt, not sent.
              destination={taskId ? "terminal" : "prompt"}
            />
          </OnWorktree>
        </Frame>
      );

    case "diff":
      return (
        <Frame ref={frame}>
          <OnWorktree root={root} worktree={worktree}>
            <DiffFilePane root={paneRoot} view={view} path={descriptor.path} onOpenFile={openFile} />
          </OnWorktree>
        </Frame>
      );

    case "file":
      return (
        <Frame ref={frame}>
          <OnWorktree root={root} worktree={worktree}>
            <FilePane
              root={paneRoot}
              view={view}
              path={descriptor.path}
              line={descriptor.line}
              anchor={descriptor.anchor}
              anchorAt={descriptor.anchorAt}
              taskHref={taskHref}
              worktree={worktree}
              onOpenFile={openFile}
              onOpenDiff={openDiff}
            />
          </OnWorktree>
        </Frame>
      );

    case "commit":
      return (
        <Frame ref={frame}>
          <CommitPane root={root} view={view} sha={descriptor.sha} onOpenCommit={openCommit} />
        </Frame>
      );

    case "history":
      return (
        <Frame ref={frame}>
          <HistoryPane
            root={root}
            view={view}
            onOpenCommit={openCommit}
            onOpenChanges={openChanges}
          />
        </Frame>
      );
  }
}

/** A working-tree pane under its worktree's line when it is on one, and as it
 * always was when it is not. */
function OnWorktree({ root, worktree, children }: { root: RepoRoot; worktree?: string; children: ReactNode }) {
  if (!worktree) return <>{children}</>;
  return (
    <WorktreeFrame root={root} worktree={worktree}>
      {children}
    </WorktreeFrame>
  );
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
