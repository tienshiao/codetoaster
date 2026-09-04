import { useCallback, useMemo, useRef, type ReactNode } from "react";
import {
  FileDiff,
  Files,
  GitBranch,
  GitCommitHorizontal,
  ListTodo,
  type LucideIcon,
} from "lucide-react";
import type { ExplorerRailItem } from "@/frontend/components/v2/ExplorerRail";
import { BacklogSection } from "@/frontend/components/BacklogSection";
import {
  ExplorerError,
  ExplorerLoading,
  ExplorerNote,
} from "@/frontend/components/explorer-notes";
import { FileTree as DiffFileTree } from "@/frontend/components/diff/FileTree";
import { FileTree as WorkspaceFileTree } from "@/frontend/components/file/FileTree";
import { CommitList } from "@/frontend/components/git/CommitList";
import { RefSidebar, type RefSidebarHeadExpanded } from "@/frontend/components/git/RefSidebar";
import { useBacklog } from "@/frontend/hooks/use-backlog";
import { useGitHistory } from "@/frontend/hooks/use-git-history";
import { useTaskDiff } from "@/frontend/hooks/use-task-diff";
import { useTaskFiles } from "@/frontend/hooks/use-task-files";
import { useViewState } from "@/frontend/hooks/use-view-state";
import {
  EXPLORER_SECTIONS,
  type BacklogTab,
  type ExplorerSection,
} from "@/frontend/explorer-store";
import type { OpenOptions, TabDescriptor } from "@/frontend/layout-store";
import { getViewState, setViewField, viewRef } from "@/frontend/view-state-store";

/**
 * The Explorer's body (§7.1): the five sections that live in the right-hand
 * panel.
 *
 * This is the body and not the chrome. `AppShell` owns the rail, the panel
 * itself, the title band and the footer slot; what arrives here is one section
 * at a time, already chosen.
 *
 * Every section is a tree that already exists — the diff tree, the file tree,
 * the commit graph, the ref sidebar — hosted rather than rebuilt, which is why
 * the only thing this file adds to them is preview/pin and a descriptor. And
 * a selection is a *tab*, not a pane below the tree: that is what makes two
 * files, or a commit and the working tree, comparable side by side.
 */

const SECTION_ICONS: Record<ExplorerSection, LucideIcon> = {
  Changes: FileDiff,
  Files: Files,
  History: GitCommitHorizontal,
  Refs: GitBranch,
  Backlog: ListTodo,
};

/**
 * The rail's items for a task. The glyphs are the ones the tab kinds each
 * section opens already use, so a rail icon and the tab it produces read as
 * the same thing — and the changed-file count rides the rail rather than the
 * panel header precisely so it still reads with the panel shut.
 *
 * Backlog is *absent* rather than disabled when the repository is not a
 * Backlog.md one (TASK-85): a permanently greyed rail item is a promise about a
 * feature this repository will never have, and the rail is four icons tall.
 */
export function useExplorerRail(taskId: string | null): ExplorerRailItem[] {
  const { data } = useTaskDiff(taskId ?? "", taskId != null);
  const count = data?.length;
  const backlog = useBacklog(taskId).data?.detected === true;
  return useMemo(
    () =>
      EXPLORER_SECTIONS.filter((label) => label !== "Backlog" || backlog).map((label) => ({
        label,
        icon: SECTION_ICONS[label],
        count: label === "Changes" ? count : undefined,
      })),
    [count, backlog],
  );
}

export interface ExplorerProps {
  taskId: string | null;
  section: ExplorerSection;
  /** The Backlog section's Open/Closed split, held by the panel so it survives
   * the section being unmounted (TASK-85). */
  backlogTab: BacklogTab;
  onBacklogTabChange: (tab: BacklogTab) => void;
  /** Opening a tab is the layout's business; the Explorer only says what. */
  onOpenTab: (descriptor: TabDescriptor, options?: OpenOptions) => void;
}

export function Explorer({
  taskId,
  section,
  backlogTab,
  onBacklogTabChange,
  onOpenTab,
}: ExplorerProps): ReactNode {
  const preview = usePreviewOpen(onOpenTab);

  if (taskId == null) {
    return (
      <div className="grid h-full place-items-center px-3 text-center text-xs text-subtle-foreground">
        Pick a task to see its files.
      </div>
    );
  }

  // One section at a time: the others are unmounted, not hidden. That is what
  // lets each hold its own queries without four sections' worth of git running
  // for a panel showing one of them.
  switch (section) {
    case "Changes":
      return <ChangesSection taskId={taskId} {...preview} />;
    case "Files":
      return <FilesSection taskId={taskId} {...preview} />;
    case "History":
      return <HistorySection taskId={taskId} onOpenTab={onOpenTab} {...preview} />;
    case "Refs":
      return <RefsSection taskId={taskId} {...preview} />;
    case "Backlog":
      return (
        <BacklogSection
          taskId={taskId}
          backlogTab={backlogTab}
          onBacklogTabChange={onBacklogTabChange}
          {...preview}
        />
      );
  }
}

// ── preview / pin ───────────────────────────────────────────────────────────

interface PreviewOpen {
  open: (descriptor: TabDescriptor) => void;
  handlers: { onClick: () => void; onDoubleClick: () => void };
}

/**
 * VSCode's preview tab, over trees that only know how to be single-clicked
 * (§7.2). A click opens an italic tab the next click replaces; the
 * double-click that follows re-opens the same descriptor as permanent, which
 * is how `openTab` pins it.
 *
 * The claim flag is what keeps a double-clicked *directory* from pinning
 * whatever file was opened before it: the row's handler runs before the
 * wrapper's, so a click that opened nothing is visible here as an unclaimed
 * one, and it clears the pending descriptor.
 */
function usePreviewOpen(onOpenTab: (d: TabDescriptor, o?: OpenOptions) => void): PreviewOpen {
  const pending = useRef<TabDescriptor | null>(null);
  const claimed = useRef(false);

  const open = useCallback(
    (descriptor: TabDescriptor) => {
      pending.current = descriptor;
      claimed.current = true;
      onOpenTab(descriptor, { preview: true });
    },
    [onOpenTab],
  );

  const handlers = useMemo(
    () => ({
      onClick: () => {
        if (!claimed.current) pending.current = null;
        claimed.current = false;
      },
      onDoubleClick: () => {
        if (pending.current) onOpenTab(pending.current);
      },
    }),
    [onOpenTab],
  );

  return { open, handlers };
}

type SectionProps = PreviewOpen & { taskId: string };

// ── sections ────────────────────────────────────────────────────────────────

// A section maps a row to a descriptor and hands it to `open`; nothing here
// checks whether that descriptor is already open, because `openTab` focuses the
// tab with a matching `tabKey` rather than opening a second one.

function ChangesSection({ taskId, open, handlers }: SectionProps) {
  const { data, isLoading, error, refetch } = useTaskDiff(taskId);
  const view = useMemo(() => viewRef(taskId, "explorer"), [taskId]);
  const [selectedFile, setSelectedFile] = useViewState("explorer", view, "changesSelectedFile");
  const [collapsedPaths, setCollapsedPaths] = useViewState(
    "explorer",
    view,
    "changesCollapsedPaths",
  );

  const totals = useMemo(() => {
    const files = data ?? [];
    return {
      additions: files.reduce((sum, f) => sum + f.additions, 0),
      deletions: files.reduce((sum, f) => sum + f.deletions, 0),
    };
  }, [data]);

  if (isLoading) return <ExplorerLoading>Loading changes…</ExplorerLoading>;

  if (error) {
    return (
      <ExplorerError onRetry={() => refetch()}>
        {error instanceof Error ? error.message : String(error)}
      </ExplorerError>
    );
  }

  if (!data || data.length === 0) return <ExplorerNote>No changes.</ExplorerNote>;

  return (
    <div className="flex h-full min-h-0 flex-col" {...handlers}>
      <DiffFileTree
        className="border-r-0"
        files={data}
        selectedFile={selectedFile}
        onSelectFile={(path) => {
          setSelectedFile(path);
          open({ kind: "diff", path });
        }}
        totalAdditions={totals.additions}
        totalDeletions={totals.deletions}
        collapsedPaths={collapsedPaths}
        onCollapsedPathsChange={setCollapsedPaths}
      />
    </div>
  );
}

function FilesSection({ taskId, open, handlers }: SectionProps) {
  const { data, isLoading, error, refetch } = useTaskFiles(taskId);
  // The `files` slot, shared with the tree v1's file route still draws: it is
  // the same tree over the same working copy, so a directory collapsed in one
  // has no business springing open in the other.
  const view = useMemo(() => viewRef(taskId, "files"), [taskId]);
  const [selectedFile, setSelectedFile] = useViewState("files", view, "selectedFile");
  const [expandedPaths, setExpandedPaths] = useViewState("files", view, "expandedPaths");

  if (isLoading) return <ExplorerLoading>Loading files…</ExplorerLoading>;

  if (error) {
    return (
      <ExplorerError onRetry={() => refetch()}>
        {error instanceof Error ? error.message : String(error)}
      </ExplorerError>
    );
  }

  const files = data?.files ?? [];
  if (files.length === 0) return <ExplorerNote>No files.</ExplorerNote>;

  return (
    <div className="flex h-full min-h-0 flex-col" {...handlers}>
      <WorkspaceFileTree
        className="border-r-0"
        files={files}
        selectedFile={selectedFile}
        onSelectFile={(path) => {
          setSelectedFile(path);
          open({ kind: "file", path });
        }}
        expandedPaths={expandedPaths}
        onExpandedPathsChange={setExpandedPaths}
      />
    </div>
  );
}

function HistorySection({
  taskId,
  open,
  handlers,
  onOpenTab,
}: SectionProps & { onOpenTab: (d: TabDescriptor, o?: OpenOptions) => void }) {
  const view = useMemo(() => viewRef(taskId, "explorer"), [taskId]);
  const openCommit = useCallback((sha: string) => open({ kind: "commit", sha }), [open]);
  const { logQuery, refsQuery, refSets, commits, pendingRefSha } = useGitHistory(taskId, openCommit);

  if (logQuery.isLoading) return <ExplorerLoading>Loading history…</ExplorerLoading>;

  if (logQuery.error) {
    return (
      <ExplorerError onRetry={() => logQuery.refetch()}>
        {logQuery.error instanceof Error ? logQuery.error.message : String(logQuery.error)}
      </ExplorerError>
    );
  }

  if (commits.length === 0) return <ExplorerNote>No commits.</ExplorerNote>;

  return (
    <div className="flex h-full min-h-0 flex-col" {...handlers}>
      {/* Refs failed but the log succeeded: surface it without blanking the
          section — only the decorations and the HEAD default are missing. */}
      {refsQuery.error && (
        <ExplorerNote>Could not load branch/tag refs — decorations are missing.</ExplorerNote>
      )}
      <div className="min-h-0 flex-1 overflow-hidden">
        <CommitList
          // 272px of panel: the author and sha columns would leave the commit
          // message no width at all, and they are both in the tab a row opens.
          compact
          commits={commits}
          // No row is "the" selection: picking one opens a tab rather than
          // filling a pane, so the graph has nothing to stay highlighted for.
          selectedSha={undefined}
          onSelect={openCommit}
          hasMore={logQuery.hasNextPage ?? false}
          isFetchingNextPage={logQuery.isFetchingNextPage}
          // Paused while a ref-seek (fetchUntil) is in flight so the two append
          // paths can't compute pages from the same cursor.
          onLoadMore={() => {
            if (!pendingRefSha) logQuery.fetchNextPage();
          }}
          refSets={refSets}
          // Permanent, not preview: the working-tree diff is a destination, not
          // a row the user arrows through.
          onLocalChanges={() => onOpenTab({ kind: "diffAll" })}
          initialScrollTop={getViewState("explorer", view).commitsScrollTop}
          onScrollTopChange={(top) => setViewField("explorer", view, "commitsScrollTop", top)}
        />
      </div>
    </div>
  );
}

function RefsSection({ taskId, open, handlers }: SectionProps) {
  const view = useMemo(() => viewRef(taskId, "explorer"), [taskId]);
  const openCommit = useCallback((sha: string) => open({ kind: "commit", sha }), [open]);
  // The same hook the History section holds. react-query dedupes the log and
  // refs queries by key, so two sections asking for them is one fetch — and
  // only one of the two is ever mounted anyway.
  const { refsQuery, pendingRefSha, selectRef } = useGitHistory(taskId, openCommit);

  const [refsClosedSections, setRefsClosedSections] = useViewState(
    "explorer",
    view,
    "refsClosedSections",
  );
  const [refsExpanded, setRefsExpanded] = useViewState("explorer", view, "refsExpanded");

  // Read/write handle rather than a value: RefSidebar's HEAD-reveal effect has
  // to read and write this synchronously, so it runs once per HEAD value and
  // not once per remount — which would undo a user's collapse of HEAD's
  // ancestor folders on every section switch.
  const headExpanded = useMemo<RefSidebarHeadExpanded>(
    () => ({
      get: () => getViewState("explorer", view).refsHeadExpandedFor,
      set: (branch) => setViewField("explorer", view, "refsHeadExpandedFor", branch),
    }),
    [view],
  );

  if (refsQuery.isLoading) return <ExplorerLoading>Loading refs…</ExplorerLoading>;

  return (
    <div className="flex h-full min-h-0 flex-col" {...handlers}>
      {/* `selectRef`, not `open` directly: a ref below the loaded log window
          has to be paged in before there is a commit to show, and `selectRef`
          is what does the seek. The pin bookkeeping still rides along because
          it hangs off the `onSelect` handed to `useGitHistory` — which runs
          synchronously inside the click for an already-loaded ref, and for a
          paged-in one the user is watching a spinner rather than
          double-clicking. */}
      <RefSidebar
        className="w-full border-r-0"
        refs={refsQuery.data}
        refsError={!!refsQuery.error}
        onSelectRef={selectRef}
        pendingSha={pendingRefSha}
        closedSections={refsClosedSections}
        onClosedSectionsChange={setRefsClosedSections}
        refsExpanded={refsExpanded}
        onRefsExpandedChange={setRefsExpanded}
        headExpanded={headExpanded}
      />
    </div>
  );
}

// The empty/loading/error states the sections share live in
// `explorer-notes.tsx`, so a section in a file of its own can reach them
// without importing this one back.
