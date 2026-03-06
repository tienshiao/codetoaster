import { useState, useEffect } from "react";
import { FileTree } from "./components/file/FileTree";
import { FileContent } from "./components/file/FileContent";
import { Button } from "./components/ui/button";
import { Loader2, RefreshCw, WrapText } from "lucide-react";
import { useSessionFiles, useFileContent } from "./hooks/use-session-files";

interface FileViewProps {
  sessionId: string;
  file?: string;
}

export function FileView({ sessionId, file }: FileViewProps) {
  const { data: filesData, isLoading: loading, error: queryError, refetch } = useSessionFiles(sessionId);
  const error = queryError ? (queryError instanceof Error ? queryError.message : String(queryError)) : null;
  const files = filesData?.files ?? [];
  const [selectedFile, setSelectedFile] = useState<string | null>(file ?? null);
  const [lineWrap, setLineWrap] = useState(false);

  useEffect(() => {
    if (file) setSelectedFile(file);
  }, [file]);

  const { data: fileContent = null, isLoading: contentLoading } = useFileContent(sessionId, selectedFile);

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
          files={files}
          selectedFile={selectedFile}
          onSelectFile={setSelectedFile}
        />
      </div>
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-mono text-foreground">{selectedFile || "No file selected"}</span>
          </div>
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
        <FileContent
          key={selectedFile || ""}
          filePath={selectedFile || ""}
          sessionId={sessionId}
          content={fileContent}
          loading={contentLoading}
          lineWrap={lineWrap}
        />
      </div>
    </div>
  );
}