import { useQuery } from "@tanstack/react-query";
import type { FileContentResponse, FilesResponse } from "../types/file";

async function fetchFiles(taskId: string): Promise<FilesResponse> {
  const res = await fetch(`/api/tasks/${taskId}/files`);
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to fetch files");
  }
  return res.json();
}

async function fetchFileContent(taskId: string, filePath: string): Promise<FileContentResponse> {
  const res = await fetch(
    `/api/tasks/${taskId}/file?file=${encodeURIComponent(filePath)}`
  );
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to fetch file content");
  }
  return res.json();
}

export function useTaskFiles(taskId: string) {
  return useQuery({
    queryKey: ["tasks", taskId, "files"],
    queryFn: () => fetchFiles(taskId),
  });
}

export function useFileContent(taskId: string, filePath: string | null) {
  return useQuery({
    queryKey: ["tasks", taskId, "file", filePath],
    queryFn: () => fetchFileContent(taskId, filePath!),
    enabled: filePath !== null,
  });
}
