import { useEffect, useRef, useState } from "react";
import { FileTree } from "./components/file/FileTree";
import { FileContent } from "./components/file/FileContent";
import { Button } from "./components/ui/button";
import { Loader2, RefreshCw, WrapText, Eye } from "lucide-react";
import { useSessionFiles, useFileContent } from "./hooks/use-session-files";
import { useViewState } from "./hooks/use-view-state";
import { getViewState } from "./view-state-store";
import { getLanguageFromPath } from "./utils/languageDetection";
import { SymbolPopover, type SymbolTarget } from "./components/SymbolPopover";

interface FileViewProps {
  sessionId: string;
  file?: string;
  highlightLine?: number;
  onSelectFile: (path: string | null) => void;
}

export function FileView({ sessionId, file, highlightLine, onSelectFile }: FileViewProps) {
  const [symbolTarget, setSymbolTarget] = useState<SymbolTarget | null>(null);
  const { data: filesData, isLoading: loading, error: queryError, refetch } = useSessionFiles(sessionId);
  const error = queryError ? (queryError instanceof Error ? queryError.message : String(queryError)) : null;
  const files = filesData?.files ?? [];
  const selectedFile = file ?? null;
  const [lineWrap, setLineWrap] = useViewState(sessionId, "fileView", "lineWrap");
  const [markdownPreview, setMarkdownPreview] = useViewState(sessionId, "fileView", "markdownPreview");
  const isMarkdown = selectedFile ? getLanguageFromPath(selectedFile)?.name === "Markdown" : false;
  const restoredRef = useRef(false);
  // Snapshot the stored selection at mount, before the mirror effect below
  // overwrites it with the (possibly absent) URL selection
  const initialStoredFileRef = useRef(getViewState(sessionId).fileView.selectedFile);

  // Mirror the URL selection into the store so tab/session switches restore it.
  // Track null too, so clearing a selection doesn't leave a stale stored path.
  useEffect(() => {
    getViewState(sessionId).fileView.selectedFile = selectedFile;
  }, [selectedFile, sessionId]);

  // Mounted without a ?file= param: restore the last-viewed file, but only once
  // the file list has loaded and only if the file still exists (no stale flash).
  useEffect(() => {
    if (restoredRef.current || file || !filesData) return;
    restoredRef.current = true;
    const stored = initialStoredFileRef.current;
    if (stored && filesData.files.some((f) => !f.isDirectory && f.path === stored)) {
      onSelectFile(stored);
    }
  }, [file, filesData, onSelectFile]);

  // Reconcile: the selected file may have been deleted while we were away. The
  // cached listing can also predate a just-created file (e.g. one picked via
  // the live search endpoint), so confirm against a fresh listing before clearing.
  useEffect(() => {
    if (!filesData || !selectedFile) return;
    if (filesData.files.some((f) => !f.isDirectory && f.path === selectedFile)) return;
    let cancelled = false;
    refetch().then((result) => {
      if (cancelled) return;
      const fresh = result.data;
      if (fresh && !fresh.files.some((f) => !f.isDirectory && f.path === selectedFile)) {
        onSelectFile(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [filesData, selectedFile, onSelectFile, refetch]);

  const { data: fileContent = null, isLoading: contentLoading } = useFileContent(sessionId, selectedFile);

  const scrollTops = getViewState(sessionId).fileView.scrollTops;
  // Source and rendered-markdown views have unrelated content heights, so
  // scroll offsets (and FileContent's mount) are keyed by mode as well as path
  const previewActive = isMarkdown && markdownPreview;
  const scrollKey = selectedFile ? (previewActive ? `md-preview:${selectedFile}` : selectedFile) : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm gap-2">
        <Loader2 className="animate-spin" size={16} />
        Loading files...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm gap-3">
        <p>{error}</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw size={14} /> Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <div className="w-[280px] shrink-0">
        <FileTree
          sessionId={sessionId}
          files={files}
          selectedFile={selectedFile}
          onSelectFile={onSelectFile}
        />
      </div>
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-mono text-foreground">{selectedFile || "No file selected"}</span>
          </div>
          <div className="flex items-center gap-1">
            {isMarkdown && (
              <Button
                variant={markdownPreview ? "secondary" : "ghost"}
                size="sm"
                className="h-6 w-6 p-0"
                title="Preview"
                onClick={() => setMarkdownPreview(!markdownPreview)}
              >
                <Eye size={14} />
              </Button>
            )}
            <Button
              variant={lineWrap ? "secondary" : "ghost"}
              size="sm"
              className="h-6 w-6 p-0"
              title="Wrap"
              onClick={() => setLineWrap(!lineWrap)}
            >
              <WrapText size={14} />
            </Button>
          </div>
        </div>
        <FileContent
          key={scrollKey || ""}
          filePath={selectedFile || ""}
          sessionId={sessionId}
          content={fileContent}
          loading={contentLoading}
          lineWrap={lineWrap}
          markdownPreview={markdownPreview}
          initialScrollTop={scrollKey ? scrollTops.get(scrollKey) : undefined}
          onScrollTopChange={(top) => {
            if (scrollKey) scrollTops.set(scrollKey, top);
          }}
          highlightLine={highlightLine}
          onSymbolClick={(name, x, y) => setSymbolTarget({ name, x, y })}
        />
      </div>
      <SymbolPopover sessionId={sessionId} target={symbolTarget} onClose={() => setSymbolTarget(null)} />
    </div>
  );
}
