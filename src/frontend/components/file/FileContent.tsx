import { useMemo, useRef, useEffect, useLayoutEffect, type MouseEvent } from "react";
import { rootApi, type RepoRoot } from "@/frontend/repo-root";
import { MarkdownPreview, type AnchorJump } from "./MarkdownPreview";
import { TablePreview } from "./TablePreview";
import { delimiterForPath, parseDelimited, type DelimitedTable } from "../../utils/delimited";
import { syntaxTokensFor } from "../../utils/wordDiff";
import { getLanguageFromPath } from "../../utils/languageDetection";
import { FileIcon } from "../diff/FileIcon";
import { formatSize } from "../../utils/formatSize";
import type { FileContentResponse } from "../../types/file";
import type { LineTokens } from "../../../types/highlight";
import { symbolAtPoint } from "../../utils/symbolClick";
import { useModifierHeld } from "../../hooks/use-modifier-held";
import { useSymbolHighlight } from "../../hooks/use-symbol-highlight";
import { maybeShowSymbolTip } from "../../utils/tips";

interface FileContentProps {
  filePath: string;
  root: RepoRoot;
  content: FileContentResponse | null;
  loading: boolean;
  lineWrap: boolean;
  /** Render markdown, and CSV/TSV as a table, instead of the source. */
  markdownPreview?: boolean;
  initialScrollTop?: number;
  onScrollTopChange?: (top: number) => void;
  highlightLine?: number;
  onSymbolClick?: (name: string, x: number, y: number) => void;
  /** A repository link clicked in the markdown preview, by its raw `href`. */
  onOpenLink?: (href: string) => void;
  /** Where the markdown preview loads a repository image from. */
  resolveImage?: (src: string) => Promise<string | null>;
  /** A heading for the markdown preview to scroll to. */
  anchorJump?: AnchorJump | null;
  /** The preview carried out the jump with this `seq`. */
  onAnchorJumped?: (seq: number, landed: boolean) => void;
  // Overrides the default working-tree image endpoint (git view reads a blob at
  // a specific sha via /image/git). When omitted, the working-tree URL is used.
  imageUrl?: string;
}

export function FileContent({
  filePath,
  root,
  content,
  loading,
  lineWrap,
  markdownPreview,
  initialScrollTop,
  onScrollTopChange,
  highlightLine,
  onSymbolClick,
  onOpenLink,
  resolveImage,
  anchorJump,
  onAnchorJumped,
  imageUrl: imageUrlProp,
}: FileContentProps) {
  const langConfig = useMemo(() => getLanguageFromPath(filePath), [filePath]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const restoredScrollRef = useRef(false);
  const jumpLandedRef = useRef(false);
  const modHeld = useModifierHeld();
  const symbolHover = useSymbolHighlight(modHeld && !!onSymbolClick, content);

  // First time a code file is shown, nudge the ⌘/Ctrl-click gesture (once ever).
  useEffect(() => {
    if (onSymbolClick && content && !content.isBinary) maybeShowSymbolTip();
  }, [content, onSymbolClick]);

  // The rendered preview and the tokenized source view are mutually exclusive,
  // so each derivation below is gated on this: whole-file work for the branch
  // that won't render is pure waste (the git file browser, which never enables
  // the preview, would otherwise join every file it opens into a second copy).
  const showMarkdown = !!markdownPreview && langConfig?.name === "Markdown";
  const delimiter = markdownPreview ? delimiterForPath(filePath) : null;
  const showTable = delimiter !== null;
  const showPreview = showMarkdown || showTable;

  // Per-line tokens: prefer server tree-sitter tokens, but only when they
  // reconstruct the line exactly (guards against a stale diff/content race or an
  // unsupported grammar); otherwise fall back to the client regex tokenizer.
  // syntaxTokensFor centralizes that choice (shared with the diff view).
  const lineTokens = useMemo<LineTokens[]>(() => {
    if (showPreview || !content || content.isBinary) return [];
    const serverTokens = content.tokens;
    return content.lines.map((line, i) =>
      syntaxTokensFor(line.content, serverTokens?.[i] ?? null, langConfig)
        ?? [{ text: line.content, type: null }],
    );
  }, [content, langConfig, showPreview]);

  // The parsed frontmatter, only when the preview is the branch that renders:
  // the source view shows the raw block, unchanged (TASK-87).
  const frontmatter = showMarkdown && content && !content.isBinary ? content.frontmatter : undefined;

  // Joined source for the markdown preview, memoized so MarkdownPreview's memo
  // actually holds across re-renders that don't change the file. The block's
  // own lines come off the front — FrontmatterHeader draws them instead.
  const markdownSource = useMemo(
    () => (showMarkdown && content && !content.isBinary
      ? content.lines.slice(frontmatter?.lineCount ?? 0).map((line) => line.content).join("\n")
      : ""),
    [content, showMarkdown, frontmatter],
  );

  // Parsed rows for the table preview. Rejoined from the server's lines rather
  // than split per line, because a quoted field may span several of them.
  const table = useMemo<DelimitedTable>(
    () => (delimiter && content && !content.isBinary
      ? parseDelimited(content.lines.map((line) => line.content).join("\n"), delimiter)
      : { rows: [], rowLines: [] }),
    [content, delimiter],
  );

  // Restore scroll once the lines have rendered (content arrives async, and
  // the scroll container only exists in the text branch below)
  useLayoutEffect(() => {
    if (restoredScrollRef.current || initialScrollTop === undefined) return;
    if (!content || content.isBinary || !scrollRef.current) return;
    // The table reveals its own target row, and the preview scrolls to its
    // own heading, both in layout effects that have already run by now (a
    // child's go first): restoring here would undo them. A jump whose heading
    // was not there scrolled nothing, so the saved place still stands.
    if ((showTable && highlightLine) || jumpLandedRef.current) {
      restoredScrollRef.current = true;
      return;
    }
    scrollRef.current.scrollTop = initialScrollTop;
    restoredScrollRef.current = true;
  }, [content, initialScrollTop, showTable, highlightLine]);

  const handleAnchorJumped = (seq: number, landed: boolean) => {
    if (landed) jumpLandedRef.current = true;
    onAnchorJumped?.(seq, landed);
  };

  // Deep link (go-to-definition): scroll the target line into view and flash it.
  // Takes precedence over the saved scroll position when a line is specified.
  useLayoutEffect(() => {
    if (!highlightLine || showTable || !content || content.isBinary || !scrollRef.current) return;
    restoredScrollRef.current = true; // don't fight this with scroll-restore
    const row = scrollRef.current.querySelector<HTMLElement>(`[data-line="${highlightLine}"]`);
    if (!row) return;
    row.scrollIntoView({ block: "center" });
    row.classList.remove("line-flash");
    // Force reflow so re-adding the class restarts the animation.
    void row.offsetWidth;
    row.classList.add("line-flash");
  }, [highlightLine, content, showTable]);

  const handleClick = (e: MouseEvent) => {
    if (!onSymbolClick || !(e.metaKey || e.ctrlKey)) return;
    const name = symbolAtPoint(e.clientX, e.clientY);
    if (name) {
      e.preventDefault();
      onSymbolClick(name, e.clientX, e.clientY);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading file...
      </div>
    );
  }

  if (!content) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No file selected
      </div>
    );
  }

  if (content.isBinary) {
    if (content.isImage) {
      const imageUrl = imageUrlProp ?? `${rootApi(root)}/image?file=${encodeURIComponent(filePath)}`;
      return (
        <div className="flex flex-col items-center justify-center p-8 h-full">
          <img
            src={imageUrl}
            alt={filePath}
            className="max-w-full max-h-[600px] object-contain border border-border"
          />
          <p className="mt-4 text-xs text-muted-foreground font-mono truncate">{filePath}</p>
          <p className="text-xs text-muted-foreground">{formatSize(content.size || 0)}</p>
        </div>
      );
    }

    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center p-8">
          <div className="mx-auto w-16 h-16 mb-4 rounded-full bg-muted flex items-center justify-center">
            <FileIcon filename={filePath} isFolder={false} />
          </div>
          <h3 className="text-sm font-medium mb-2">Binary File</h3>
          <p className="text-xs text-muted-foreground mb-4">This file cannot be displayed as text</p>
          <p className="text-xs text-muted-foreground font-mono truncate max-w-xs mx-auto">{filePath}</p>
          <p className="text-xs text-muted-foreground">{formatSize(content.size || 0)}</p>
        </div>
      </div>
    );
  }

  const lines = content.lines;

  if (lines.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm italic">
        Empty file
      </div>
    );
  }

  if (showMarkdown) {
    return (
      <div
        ref={scrollRef}
        className="overflow-auto h-full"
        onScroll={(e) => onScrollTopChange?.(e.currentTarget.scrollTop)}
      >
        <MarkdownPreview
          source={markdownSource}
          frontmatter={frontmatter}
          onOpenLink={onOpenLink}
          resolveImage={resolveImage}
          jump={anchorJump}
          onJumped={handleAnchorJumped}
        />
      </div>
    );
  }

  if (showTable) {
    return (
      <TablePreview
        rows={table.rows}
        rowLines={table.rowLines}
        highlightLine={highlightLine}
        scrollRef={scrollRef}
        onScroll={onScrollTopChange}
        wrap={lineWrap}
      />
    );
  }

  const maxLineNum = lines.length.toString().length;

  return (
    <div
      ref={scrollRef}
      className="overflow-auto h-full"
      onScroll={(e) => onScrollTopChange?.(e.currentTarget.scrollTop)}
    >
      <div
        className={`min-w-fit ${onSymbolClick ? "symbol-clickable" : ""} ${modHeld ? "mod-held" : ""}`}
        onClick={handleClick}
        {...symbolHover}
      >
        {lines.map((line, idx) => {
          const tokens = lineTokens[idx] ?? [];

          return (
            <div key={line.lineNum} data-line={line.lineNum} className="flex group">
              <div className="w-12 shrink-0 text-right pr-4 text-xs text-muted-foreground/50 select-none border-r border-border">
                {line.lineNum.toString().padStart(maxLineNum, " ")}
              </div>
              <div className={`flex-1 px-2 py-0.5 font-mono text-xs ${lineWrap ? 'whitespace-pre-wrap' : 'whitespace-pre'} hover:bg-accent/30`}>
                {tokens.map((token, i) => {
                  const className = token.type ? `syntax-${token.type}` : undefined;
                  return <span key={i} className={className}>{token.text}</span>;
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}