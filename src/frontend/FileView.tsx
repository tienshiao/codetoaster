import { useState, useEffect, useCallback } from "react";
import { FileTree } from "./components/file/FileTree";
import { FileContent } from "./components/file/FileContent";
import { Button } from "./components/ui/button";
import { Checkbox } from "./components/ui/checkbox";
import { Loader2, RefreshCw, WrapText } from "lucide-react";
import type { FileInfo, FileContentResponse, FilesResponse } from "./types/file";

interface FileViewProps {
  sessionId: string;
}

export function FileView({ sessionId }: FileViewProps) {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [directory, setDirectory] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<FileContentResponse | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [lineWrap, setLineWrap] = useState(false);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/files`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to fetch files");
      }
      const data: FilesResponse = await res.json();
      setFiles(data.files);
      setDirectory(data.directory);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const fetchFileContent = useCallback(async (filePath: string) => {
    setContentLoading(true);
    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/file?file=${encodeURIComponent(filePath)}`
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to fetch file content");
      }
      const data: FileContentResponse = await res.json();
      setFileContent(data);
    } catch (e) {
      console.error("Failed to load file:", e);
      setFileContent(null);
    } finally {
      setContentLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const handleSelectFile = useCallback(
    (path: string) => {
      setSelectedFile(path);
      fetchFileContent(path);
    },
    [fetchFileContent]
  );

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
        <Button variant="outline" size="sm" onClick={fetchFiles}>
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
          onSelectFile={handleSelectFile}
        />
      </div>
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-mono text-foreground">{selectedFile || "No file selected"}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Checkbox
              id="lineWrap"
              checked={lineWrap}
              onCheckedChange={(checked: boolean) => setLineWrap(checked)}
            />
            <label htmlFor="lineWrap" className="flex items-center gap-1 cursor-pointer">
              <WrapText size={14} />
              Wrap
            </label>
          </div>
        </div>
        <FileContent
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