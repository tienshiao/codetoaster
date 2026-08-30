import { useState } from "react";
import { Eye, WrapText } from "lucide-react";
import { IconButton } from "@/frontend/components/v2";
import { FileContent } from "@/frontend/components/file/FileContent";
import { SymbolPopover, type SymbolTarget } from "@/frontend/components/SymbolPopover";
import { useFileContent } from "@/frontend/hooks/use-task-files";
import { useViewState } from "@/frontend/hooks/use-view-state";
import { getViewState, touchViewState, type ViewRef } from "@/frontend/view-state-store";
import { getLanguageFromPath } from "@/frontend/utils/languageDetection";

interface FilePaneProps {
  taskId: string;
  /** The `file:<path>` slot. */
  view: ViewRef;
  path: string;
  /** Where a go-to-definition landed. Not part of the tab key, so jumping to
   * another line in an open file moves the cursor instead of opening the file
   * twice — which means this arrives as a changed prop, not a remount. */
  line?: number;
  /** Opens a file at a line — where go-to-definition lands. Opening tabs is the
   * layout's business, so it arrives here as a callback. */
  onOpenFile: (path: string, line: number) => void;
}

/**
 * A `file` tab: one file's contents.
 *
 * There is no tree here. The tree is the Explorer's (§7.1) and outlives every
 * file tab it opens, so a pane that carried one would be drawing the same tree
 * once per open file.
 */
export function FilePane({ taskId, view, path, line, onOpenFile }: FilePaneProps) {
  const [symbolTarget, setSymbolTarget] = useState<SymbolTarget | null>(null);
  const [lineWrap, setLineWrap] = useViewState("file", view, "lineWrap");
  const [markdownPreview, setMarkdownPreview] = useViewState("file", view, "markdownPreview");
  const { data: content = null, isLoading } = useFileContent(taskId, path);

  const isMarkdown = getLanguageFromPath(path)?.name === "Markdown";
  const previewActive = isMarkdown && markdownPreview;
  // Source and rendered markdown have unrelated content heights, so the offset
  // — and FileContent's mount — are keyed by mode, not just by the file.
  const scrollKey = previewActive ? `md-preview:${path}` : path;
  const scrollTops = getViewState("file", view).scrollTops;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex h-row flex-none items-center gap-2 border-b border-border bg-chrome px-3">
        <span className="truncate font-mono text-micro tracking-mono text-muted-foreground">
          {path}
        </span>
        <div className="ml-auto flex flex-none items-center gap-0.5">
          {isMarkdown && (
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
        </div>
      </div>
      <FileContent
        key={scrollKey}
        filePath={path}
        taskId={taskId}
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
      />
      <SymbolPopover
        taskId={taskId}
        target={symbolTarget}
        onClose={() => setSymbolTarget(null)}
        onGo={(entry) => onOpenFile(entry.path, entry.line)}
      />
    </div>
  );
}
