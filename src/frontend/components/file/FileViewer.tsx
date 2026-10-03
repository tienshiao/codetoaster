import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Eye, FileDiff, FolderSearch, WrapText } from "lucide-react";
import { toast } from "sonner";
import { rootGitImageUrl, rootId, rootImageUrl, type RepoRoot } from "@/frontend/repo-root";
import { IconButton } from "@/frontend/components/v2";
import { SymbolPopover, type SymbolTarget } from "@/frontend/components/SymbolPopover";
import { getLanguageFromPath } from "@/frontend/utils/languageDetection";
import { delimiterForPath } from "@/frontend/utils/delimited";
import { resolveMarkdownLink } from "@/frontend/utils/markdown-links";
import type { FileContentResponse } from "@/frontend/types/file";
import { FileContent } from "./FileContent";
import type { AnchorJump } from "./MarkdownPreview";

/**
 * What a viewer remembers past its own mount. The viewer is unmounted whenever
 * its tab is not the active one, so both live in the view-state store — in
 * whichever slot the caller owns.
 */
export interface FileViewerMemory {
  /** Saved scroll offsets, by `scrollKey`: source and a rendered preview have
   * unrelated content heights, so the key carries the mode. */
  getScrollTop(key: string): number | undefined;
  setScrollTop(key: string, top: number): void;
  /** The `anchorAt` of the last heading request carried out. */
  getJumpedAt(): number | null;
  setJumpedAt(seq: number): void;
}

/** Whether `path` has a rendered form: markdown, or a CSV/TSV table. */
function hasPreview(path: string): boolean {
  return isMarkdown(path) || delimiterForPath(path) !== null;
}

export function isMarkdown(path: string): boolean {
  return getLanguageFromPath(path)?.name === "Markdown";
}

interface FileViewerProps {
  root: RepoRoot;
  path: string;
  /** The commit the file is read at (TASK-127). Its images load from that
   * commit and its symbols are looked up in that commit's files; without it,
   * both come from the working tree. */
  sha?: string;
  content: FileContentResponse | null;
  loading: boolean;
  lineWrap: boolean;
  onLineWrapChange: (wrap: boolean) => void;
  /** Render markdown, and CSV/TSV as a table, instead of the source. */
  preview: boolean;
  onPreviewChange: (preview: boolean) => void;
  memory: FileViewerMemory;
  /** Where a go-to-definition or a `#L12` link landed. */
  line?: number;
  /** The heading a markdown link pointed at (TASK-124). */
  anchor?: string;
  /** When that heading was asked for: a new value is a new request, even for
   * the same heading. */
  anchorAt?: number;
  /** The files a preview's links and images resolve against (TASK-122), asked
   * for when one is needed. Null, or a rejection, leaves the plain resolution. */
  listFiles: () => Promise<ReadonlySet<string> | null>;
  /** A markdown link's real URL (TASK-126). Without it links keep their raw
   * `href` and only the in-page behaviour. */
  hrefFor?: (href: string) => string | null;
  /** Opens a file at a line or heading — where go-to-definition and markdown
   * links land. */
  onOpenFile: (path: string, line?: number, anchor?: string) => void;
  /** Shown as "Show changes" when the file has a diff to switch to. */
  onShowChanges?: () => void;
  /** Shown as "Show in Finder" when the file is on a disk that can be shown. */
  onReveal?: () => void;
}

/**
 * One file, read: the toolbar, the content in whichever form the toggle asks
 * for, and what a reader can do from it — follow a markdown link, ⌘-click a
 * symbol.
 *
 * Shared by the file tab and a commit's File Tree so the two cannot drift
 * apart (TASK-127). What differs between them is where things come from — the
 * content, the file list, the state — and all of that arrives as props.
 */
export function FileViewer({
  root,
  path,
  sha,
  content,
  loading,
  lineWrap,
  onLineWrapChange,
  preview,
  onPreviewChange,
  memory,
  line,
  anchor,
  anchorAt,
  listFiles,
  hrefFor,
  onOpenFile,
  onShowChanges,
  onReveal,
}: FileViewerProps) {
  const [symbolTarget, setSymbolTarget] = useState<SymbolTarget | null>(null);

  const previewable = hasPreview(path);
  const previewActive = previewable && preview;
  // Source and a rendered preview have unrelated content heights, so the
  // offset — and FileContent's mount — are keyed by mode, not just by the file.
  const scrollKey = previewActive ? `md-preview:${path}` : path;
  const rootKey = rootId(root);

  // A heading to scroll the preview to (TASK-124), one request per `anchorAt`.
  // The viewer unmounts whenever its tab is not the active one, while the
  // request outlives it, so it is served once and recorded in the caller's
  // state — which outlives the mount, and the reload — or every return to the
  // tab would scroll back over the user's place.
  const jump: AnchorJump | null =
    anchor && anchorAt !== undefined && anchorAt !== memory.getJumpedAt() ? { anchor, seq: anchorAt } : null;
  // Only a markdown preview has headings to land on. A request that arrives
  // while the viewer shows source, or a CSV's table, is spent all the same, or
  // turning the preview on minutes later would jump over the place it restores.
  const showsMarkdown = previewActive && isMarkdown(path);
  const pendingSeq = jump?.seq;
  useEffect(() => {
    if (pendingSeq !== undefined && !showsMarkdown) memory.setJumpedAt(pendingSeq);
  });

  // Preview links and images resolve against the caller's file list
  // (TASK-122). A list that could not be had still yields the plain resolution.
  const resolve = async (href: string) => {
    const files = await listFiles().catch(() => null);
    return resolveMarkdownLink(href, path, files);
  };

  // Only the latest click acts, and only while the viewer is still here: the
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
    // A link to a heading of this very file goes through the caller too:
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
  const imageUrl = (file: string) => (sha ? rootGitImageUrl(root, sha, file) : rootImageUrl(root, file));
  const resolveImage = useCallback(
    async (src: string) => {
      const target = await latest.current.resolve(src);
      return target ? imageUrl(target.path) : null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `root` by its key: a new object for the same root is not a new root
    [rootKey, sha, path],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex h-row flex-none items-center gap-2 border-b border-border bg-chrome px-3">
        <span className="truncate font-mono text-micro tracking-mono text-muted-foreground">
          {path}
        </span>
        <div className="ml-auto flex flex-none items-center gap-0.5">
          {onShowChanges && (
            <IconButton icon={FileDiff} label="Show changes" size="sm" onClick={onShowChanges} />
          )}
          {previewable && (
            <IconButton
              icon={Eye}
              label="Preview"
              size="sm"
              active={preview}
              onClick={() => onPreviewChange(!preview)}
            />
          )}
          <IconButton
            icon={WrapText}
            label="Wrap"
            size="sm"
            active={lineWrap}
            onClick={() => onLineWrapChange(!lineWrap)}
          />
          {onReveal && (
            <IconButton icon={FolderSearch} label="Show in Finder" size="sm" onClick={onReveal} />
          )}
        </div>
      </div>
      <FileContent
        key={scrollKey}
        filePath={path}
        root={root}
        content={content}
        loading={loading}
        lineWrap={lineWrap}
        markdownPreview={preview}
        initialScrollTop={memory.getScrollTop(scrollKey)}
        onScrollTopChange={(top) => memory.setScrollTop(scrollKey, top)}
        highlightLine={line}
        onSymbolClick={(name, x, y) => setSymbolTarget({ name, x, y })}
        onOpenLink={onOpenLink}
        resolveImage={resolveImage}
        hrefFor={hrefFor}
        anchorJump={jump}
        onAnchorJumped={(seq) => memory.setJumpedAt(seq)}
        // The file itself, when it is an image: the blob at the commit rather
        // than whatever the working tree holds under that name now.
        imageUrl={sha ? imageUrl(path) : undefined}
      />
      <SymbolPopover
        root={root}
        sha={sha}
        target={symbolTarget}
        onClose={() => setSymbolTarget(null)}
        onGo={(entry) => onOpenFile(entry.path, entry.line)}
      />
    </div>
  );
}
