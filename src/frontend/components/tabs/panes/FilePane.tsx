import { useCallback, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { rootId, type RepoRoot } from "@/frontend/repo-root";
import { toast } from "sonner";
import { FileViewer, isMarkdown, type FileViewerMemory } from "@/frontend/components/file/FileViewer";
import { fetchTaskFiles, revealFile, useFileContent, useTaskFiles } from "@/frontend/hooks/use-task-files";
import { useChangedPaths } from "@/frontend/hooks/use-task-diff";
import { canRevealInFinder } from "@/frontend/utils/platform";
import { useViewState } from "@/frontend/hooks/use-view-state";
import { getViewState, touchViewState, type ViewRef } from "@/frontend/view-state-store";
import { resolveMarkdownLink } from "@/frontend/utils/markdown-links";
import { filePathSet } from "@/frontend/utils/path-links";
import { fileTabHref } from "@/frontend/utils/tab-link";

interface FilePaneProps {
  root: RepoRoot;
  /** The `file:<path>` slot. */
  view: ViewRef;
  path: string;
  /** Where a go-to-definition landed. Not part of the tab key, so jumping to
   * another line in an open file moves the cursor instead of opening the file
   * twice — which means this arrives as a changed prop, not a remount. */
  line?: number;
  /** The heading a markdown link pointed at (TASK-124). Like `line`, a
   * position rather than part of the tab key. */
  anchor?: string;
  /** When that heading was asked for: a new value is a new request, even for
   * the same heading. */
  anchorAt?: number;
  /** The task's route, which markdown links build real URLs on (TASK-126).
   * Absent for a project root: its links keep the in-page behaviour only. */
  taskHref?: string;
  /** Opens a file at a line or heading — where go-to-definition and markdown
   * links land. Opening tabs is the layout's business, so it arrives here as
   * a callback. */
  onOpenFile: (path: string, line?: number, anchor?: string) => void;
  /** Opens this file's working-tree diff tab (TASK-121). */
  onOpenDiff: (path: string) => void;
}

/**
 * A `file` tab: one file's contents, from the working tree.
 *
 * There is no tree here. The tree is the Explorer's (§7.1) and outlives every
 * file tab it opens, so a pane that carried one would be drawing the same tree
 * once per open file.
 *
 * What is drawn is `FileViewer`'s, shared with a commit's File Tree
 * (TASK-127). This pane is the working tree's side of it: the content, the
 * file list, and the `file:<path>` slot the state lives in.
 */
export function FilePane({
  root,
  view,
  path,
  line,
  anchor,
  anchorAt,
  taskHref,
  onOpenFile,
  onOpenDiff,
}: FilePaneProps) {
  const [lineWrap, setLineWrap] = useViewState("file", view, "lineWrap");
  const [markdownPreview, setMarkdownPreview] = useViewState("file", view, "markdownPreview");
  const { data: content = null, isLoading } = useFileContent(root, path);
  // Whether there is a diff to switch to — see `useChangedPaths` for why this
  // is not `useTaskDiff`.
  const changed = useChangedPaths(root)?.has(path) ?? false;

  const queryClient = useQueryClient();
  const rootKey = rootId(root);

  const memory = useMemo<FileViewerMemory>(
    () => ({
      getScrollTop: (key) => getViewState("file", view).scrollTops.get(key),
      setScrollTop: (key, top) => {
        getViewState("file", view).scrollTops.set(key, top);
        touchViewState(view);
      },
      getJumpedAt: () => getViewState("file", view).jumpedAt,
      setJumpedAt: (seq) => {
        getViewState("file", view).jumpedAt = seq;
        touchViewState(view);
      },
    }),
    [view],
  );

  // Preview links and images resolve against the Explorer's file list
  // (TASK-122), fetched when needed rather than watched while the preview is
  // up: most previews are read without a click, and an observer would refetch
  // the whole listing on every working-tree change.
  const listFiles = useCallback(
    async () => filePathSet(await fetchTaskFiles(queryClient, root)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `root` by its key: a new object for the same root is not a new root
    [queryClient, rootKey],
  );

  // A link's real URL (TASK-126), for what the browser does with an href on
  // its own: open in a new tab, copy the link. It has to exist when the link
  // is drawn, before any click could fetch the listing, so it reads the
  // listing from the cache — watched, not fetched, so a working-tree change
  // refetches nothing on this pane's account — and asks for it once when a
  // task's markdown preview opens. Until it arrives, a link gets the plain
  // resolution, which is right for every link but an extensionless or `/` one.
  const showsMarkdown = markdownPreview && isMarkdown(path);
  const { data: cachedFiles } = useTaskFiles(root, { enabled: false });
  useEffect(() => {
    if (taskHref && showsMarkdown) void fetchTaskFiles(queryClient, root).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `root` by its key: a new object for the same root is not a new root
  }, [taskHref, showsMarkdown, queryClient, rootKey]);
  const hrefFor = useMemo(() => {
    if (!taskHref) return undefined;
    const files = cachedFiles ? filePathSet(cachedFiles) : null;
    return (href: string) => {
      const target = resolveMarkdownLink(href, path, files);
      return target ? fileTabHref(taskHref, target) : null;
    };
  }, [taskHref, path, cachedFiles]);

  return (
    <FileViewer
      root={root}
      path={path}
      content={content}
      loading={isLoading}
      lineWrap={lineWrap}
      onLineWrapChange={setLineWrap}
      preview={markdownPreview}
      onPreviewChange={setMarkdownPreview}
      memory={memory}
      line={line}
      anchor={anchor}
      anchorAt={anchorAt}
      listFiles={listFiles}
      hrefFor={hrefFor}
      onOpenFile={onOpenFile}
      onShowChanges={changed ? () => onOpenDiff(path) : undefined}
      // The daemon reveals the file on its own machine, so the button is only
      // offered to a browser that is plausibly sitting at it.
      onReveal={
        canRevealInFinder()
          ? () =>
              revealFile(root, path).catch((e: Error) =>
                toast.error("Could not show the file in Finder", { description: e.message }),
              )
          : undefined
      }
    />
  );
}
