import { useMemo } from "react";
import { tokenizeLine, mergeTokens } from "../../utils/syntaxHighlight";
import { getLanguageFromPath } from "../../utils/languageDetection";
import { FileIcon } from "../diff/FileIcon";
import { formatSize } from "../../utils/formatSize";
import type { FileContentResponse } from "../../types/file";

interface FileContentProps {
  filePath: string;
  sessionId: string;
  content: FileContentResponse | null;
  loading: boolean;
  lineWrap: boolean;
}

export function FileContent({ filePath, sessionId, content, loading, lineWrap }: FileContentProps) {
  const langConfig = useMemo(() => getLanguageFromPath(filePath), [filePath]);

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
        <div className="flex items-center justify-center p-8 h-full">
          <div className="text-center">
            <img
              src={imageUrl}
              alt={filePath}
              className="max-w-full max-h-[600px] object-contain rounded-lg border border-border"
            />
            <p className="mt-4 text-xs text-muted-foreground font-mono truncate">{filePath}</p>
            <p className="text-xs text-muted-foreground">{formatSize(content.size || 0)}</p>
          </div>
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

  const maxLineNum = lines.length.toString().length;

  return (
    <div className="overflow-auto h-full">
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