import { useCallback, useLayoutEffect, useRef, useState } from "react";
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
export function FilePane({ root, view, path, line, anchor, onOpenFile, onOpenDiff }: FilePaneProps) {
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

  // A heading to scroll the preview to (TASK-124). It arrives two ways: as the
  // `anchor` prop, when a link from another file opens this one, and from a
  // link in this file to itself. The second cannot go through the descriptor:
  // asking for the heading it already holds changes no prop, so a repeat
  // click would do nothing. Each request gets a fresh `seq` instead.
  const [jump, setJump] = useState<AnchorJump | null>(anchor ? { anchor, seq: 1 } : null);
  const [seenAnchor, setSeenAnchor] = useState(anchor);
  if (anchor !== seenAnchor) {
    setSeenAnchor(anchor);
    if (anchor) setJump({ anchor, seq: (jump?.seq ?? 0) + 1 });
  }

  // Preview links and images resolve against the Explorer's file list
  // (TASK-122), fetched when needed rather than watched while the preview is
  // up: most previews are read without a click, and an observer would refetch
  // the whole listing on every working-tree change. A failed fetch still
  // yields the plain resolution.
  const resolve = async (href: string) => {
    const files = await fetchTaskFiles(queryClient, root).catch(() => null);
    const fileSet = files
      ? new Set(files.files.filter((file) => !file.isDirectory).map((file) => file.path))
      : null;
    return resolveMarkdownLink(href, path, fileSet);
  };

  const openLink = async (href: string) => {
    const target = await resolve(href);
    if (!target) {
      // The click was already kept from the browser; say why nothing opened.
      toast.error("That link does not name a file in this repository", { description: href });
    } else if (target.path === path && target.anchor && !target.line) {
      setJump((current) => ({ anchor: target.anchor!, seq: (current?.seq ?? 0) + 1 }));
    } else {
      onOpenFile(target.path, target.line, target.anchor);
    }
  };

  // Stable, because each image asks again whenever this changes (TASK-125).
  // `path` is a dependency all the same: a relative image means something else
  // from another file.
  const resolveRef = useRef(resolve);
  useLayoutEffect(() => {
    resolveRef.current = resolve;
  });
  const imageBase = `${rootApi(root)}/image?file=`;
  const resolveImage = useCallback(
    async (src: string) => {
      const target = await resolveRef.current(src);
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
        onOpenLink={(href) => void openLink(href)}
        resolveImage={resolveImage}
        anchorJump={jump}
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
