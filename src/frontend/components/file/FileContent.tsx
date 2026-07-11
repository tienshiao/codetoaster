import { useMemo, useRef, useLayoutEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Element } from "hast";
import { MermaidDiagram } from "./MermaidDiagram";
import { tokenizeLine, mergeTokens } from "../../utils/syntaxHighlight";
import { getLanguageFromPath } from "../../utils/languageDetection";
import { FileIcon } from "../diff/FileIcon";
import { formatSize } from "../../utils/formatSize";
import type { FileContentResponse } from "../../types/file";

/** Source text of a ```mermaid fence, given the hast node of its <pre>. */
function extractMermaidSource(node: Element | undefined): string | null {
  const child = node?.children[0];
  if (!child || child.type !== "element" || child.tagName !== "code") return null;
  const className = child.properties.className;
  if (!Array.isArray(className) || !className.includes("language-mermaid")) return null;
  const text = child.children[0];
  return text?.type === "text" ? text.value : null;
}

interface FileContentProps {
  filePath: string;
  sessionId: string;
  content: FileContentResponse | null;
  loading: boolean;
  lineWrap: boolean;
  markdownPreview?: boolean;
  initialScrollTop?: number;
  onScrollTopChange?: (top: number) => void;
}

export function FileContent({
  filePath,
  sessionId,
  content,
  loading,
  lineWrap,
  markdownPreview,
  initialScrollTop,
  onScrollTopChange,
}: FileContentProps) {
  const langConfig = useMemo(() => getLanguageFromPath(filePath), [filePath]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const restoredScrollRef = useRef(false);

  // Restore scroll once the lines have rendered (content arrives async, and
  // the scroll container only exists in the text branch below)
  useLayoutEffect(() => {
    if (restoredScrollRef.current || initialScrollTop === undefined) return;
    if (!content || content.isBinary || !scrollRef.current) return;
    scrollRef.current.scrollTop = initialScrollTop;
    restoredScrollRef.current = true;
  }, [content, initialScrollTop]);

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
      const imageUrl = `/api/sessions/${sessionId}/image?file=${encodeURIComponent(filePath)}`;
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

  if (markdownPreview && langConfig?.name === "Markdown") {
    return (
      <div
        ref={scrollRef}
        className="overflow-auto h-full"
        onScroll={(e) => onScrollTopChange?.(e.currentTarget.scrollTop)}
      >
        <div className="markdown-preview max-w-3xl px-6 py-4 text-sm">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              pre({ node, ...props }) {
                const mermaidSource = extractMermaidSource(node);
                if (mermaidSource !== null) return <MermaidDiagram source={mermaidSource} />;
                return <pre {...props} />;
              },
            }}
          >
            {lines.map((line) => line.content).join("\n")}
          </ReactMarkdown>
        </div>
      </div>
    );
  }

  const maxLineNum = lines.length.toString().length;

  return (
    <div
      ref={scrollRef}
      className="overflow-auto h-full"
      onScroll={(e) => onScrollTopChange?.(e.currentTarget.scrollTop)}
    >
      <div className="min-w-fit">
        {lines.map((line) => {
          const tokens = mergeTokens(tokenizeLine(line.content, langConfig));

          return (
            <div key={line.lineNum} className="flex group">
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