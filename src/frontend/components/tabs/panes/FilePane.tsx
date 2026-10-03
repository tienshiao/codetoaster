import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { rootApi, type RepoRoot } from "@/frontend/repo-root";
import { Eye, FileDiff, FolderSearch, WrapText } from "lucide-react";
import { toast } from "sonner";
import { IconButton } from "@/frontend/components/v2";
import { FileContent } from "@/frontend/components/file/FileContent";
import type { AnchorJump } from "@/frontend/components/file/MarkdownPreview";
import { SymbolPopover, type SymbolTarget } from "@/frontend/components/SymbolPopover";
import { fetchTaskFiles, revealFile, useFileContent } from "@/frontend/hooks/use-task-files";
import { useChangedPaths } from "@/frontend/hooks/use-task-diff";
import { canRevealInFinder } from "@/frontend/utils/platform";
import { useViewState } from "@/frontend/hooks/use-view-state";
import { getViewState, touchViewState, type ViewRef } from "@/frontend/view-state-store";
import { getLanguageFromPath } from "@/frontend/utils/languageDetection";
import { delimiterForPath } from "@/frontend/utils/delimited";
import { resolveMarkdownLink } from "@/frontend/utils/markdown-links";
import { filePathSet } from "@/frontend/utils/path-links";

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
  /** Opens a file at a line or heading — where go-to-definition and markdown
   * links land. Opening tabs is the layout's business, so it arrives here as
   * a callback. */
  onOpenFile: (path: string, line?: number, anchor?: string) => void;
  /** Opens this file's working-tree diff tab (TASK-121). */
  onOpenDiff: (path: string) => void;
}

/**
 * A `file` tab: one file's contents.
 *
 * There is no tree here. The tree is the Explorer's (§7.1) and outlives every
 * file tab it opens, so a pane that carried one would be drawing the same tree
 * once per open file.
 */
export function FilePane({ root, view, path, line, anchor, anchorAt, onOpenFile, onOpenDiff }: FilePaneProps) {
  const [symbolTarget, setSymbolTarget] = useState<SymbolTarget | null>(null);
  const [lineWrap, setLineWrap] = useViewState("file", view, "lineWrap");
  const [markdownPreview, setMarkdownPreview] = useViewState("file", view, "markdownPreview");
  const { data: content = null, isLoading } = useFileContent(root, path);
  // Whether there is a diff to switch to — see `useChangedPaths` for why this
  // is not `useTaskDiff`.
  const changed = useChangedPaths(root)?.has(path) ?? false;

  const hasPreview = getLanguageFromPath(path)?.name === "Markdown" || delimiterForPath(path) !== null;
  const previewActive = hasPreview && markdownPreview;
  // Source and a rendered preview have unrelated content heights, so the
  // offset — and FileContent's mount — are keyed by mode, not just by the file.
  const scrollKey = previewActive ? `md-preview:${path}` : path;
  const scrollTops = getViewState("file", view).scrollTops;
  const queryClient = useQueryClient();

  // A heading to scroll the preview to (TASK-124), one request per `anchorAt`.
  // This pane unmounts whenever its tab is not the active one, while the
  // descriptor keeps its anchor, so the request is served once and recorded
  // in the view state — which outlives the mount, and the reload — or every
  // return to the tab would scroll back over the user's place.
  const fileView = getViewState("file", view);
  const jump: AnchorJump | null =
    anchor && anchorAt !== undefined && anchorAt !== fileView.jumpedAt ? { anchor, seq: anchorAt } : null;
  const onAnchorJumped = (seq: number) => {
    fileView.jumpedAt = seq;
    touchViewState(view);
  };

  // Preview links and images resolve against the Explorer's file list
  // (TASK-122), fetched when needed rather than watched while the preview is
  // up: most previews are read without a click, and an observer would refetch
  // the whole listing on every working-tree change. A failed fetch still
  // yields the plain resolution.
  const resolve = async (href: string) => {
    const files = await fetchTaskFiles(queryClient, root).catch(() => null);
    return resolveMarkdownLink(href, path, files ? filePathSet(files) : null);
  };

  // Only the latest click acts, and only while the pane is still here: the
  // listing can be slow, and a link should not open after the user clicked
  // another or closed the tab.
  const latestClick = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const openLink = async (href: string) => {
    const click = ++latestClick.current;
    const target = await resolve(href);
    if (click !== latestClick.current || !mounted.current) return;
    // A link to a heading of this very file goes through the descriptor too:
    // `anchorAt` makes it a new request even when the heading is the same.
    if (target) onOpenFile(target.path, target.line, target.anchor);
    // The click was already kept from the browser; say why nothing opened.
    else toast.error("That link does not name a file in this repository", { description: href });
  };

  // Both stable: every link and image is a context consumer, and an image asks
  // again whenever its resolver changes (TASK-125). `path` stays a dependency
  // of the image resolver all the same: a relative image means something else
  // from another file.
  const latest = useRef({ resolve, openLink });
  useLayoutEffect(() => {
    latest.current = { resolve, openLink };
  });
  const onOpenLink = useCallback((href: string) => void latest.current.openLink(href), []);
  const imageBase = `${rootApi(root)}/image?file=`;
  const resolveImage = useCallback(
    async (src: string) => {
      const target = await latest.current.resolve(src);
      return target ? `${imageBase}${encodeURIComponent(target.path)}` : null;
    },
    [imageBase, path],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex h-row flex-none items-center gap-2 border-b border-border bg-chrome px-3">
        <span className="truncate font-mono text-micro tracking-mono text-muted-foreground">
          {path}
        </span>
        <div className="ml-auto flex flex-none items-center gap-0.5">
          {changed && (
            <IconButton icon={FileDiff} label="Show changes" size="sm" onClick={() => onOpenDiff(path)} />
          )}
          {hasPreview && (
            <IconButton
              icon={Eye}
              label="Preview"
              size="sm"
              active={markdownPreview}
              onClick={() => setMarkdownPreview(!markdownPreview)}
            />
          )}
          <IconButton
            icon={WrapText}
            label="Wrap"
            size="sm"
            active={lineWrap}
            onClick={() => setLineWrap(!lineWrap)}
          />
          {/* The daemon reveals the file on its own machine, so the button is
              only offered to a browser that is plausibly sitting at it. */}
          {canRevealInFinder() && (
            <IconButton
              icon={FolderSearch}
              label="Show in Finder"
              size="sm"
              onClick={() =>
                revealFile(root, path).catch((e: Error) =>
                  toast.error("Could not show the file in Finder", { description: e.message }),
                )
              }
            />
          )}
        </div>
      </div>
      <FileContent
        key={scrollKey}
        filePath={path}
        root={root}
        content={content}
        loading={isLoading}
        lineWrap={lineWrap}
        markdownPreview={markdownPreview}
        initialScrollTop={scrollTops.get(scrollKey)}
        onScrollTopChange={(top) => {
          scrollTops.set(scrollKey, top);
          touchViewState(view);
        }}
        highlightLine={line}
        onSymbolClick={(name, x, y) => setSymbolTarget({ name, x, y })}
        onOpenLink={onOpenLink}
        resolveImage={resolveImage}
        anchorJump={jump}
        onAnchorJumped={onAnchorJumped}
      />
      <SymbolPopover
        root={root}
        target={symbolTarget}
        onClose={() => setSymbolTarget(null)}
        onGo={(entry) => onOpenFile(entry.path, entry.line)}
      />
    </div>
  );
}
