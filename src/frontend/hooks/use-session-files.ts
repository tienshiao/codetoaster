import { useQuery } from "@tanstack/react-query";
import type { FileContentResponse, FilesResponse } from "../types/file";

async function fetchFiles(sessionId: string): Promise<FilesResponse> {
  const res = await fetch(`/api/sessions/${sessionId}/files`);
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to fetch files");
  }
  return res.json();
}

async function fetchFileContent(sessionId: string, filePath: string): Promise<FileContentResponse> {
  const res = await fetch(
    `/api/sessions/${sessionId}/file?file=${encodeURIComponent(filePath)}`
  );
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to fetch file content");
  }
  return res.json();
}

export function useSessionFiles(sessionId: string) {
  return useQuery({
    queryKey: ["sessions", sessionId, "files"],
    queryFn: () => fetchFiles(sessionId),
  });
}

export function useFileContent(sessionId: string, filePath: string | null) {
  return useQuery({
    queryKey: ["sessions", sessionId, "file", filePath],
    queryFn: () => fetchFileContent(sessionId, filePath!),
    enabled: filePath !== null,
  });
}
