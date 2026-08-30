import { useQuery } from "@tanstack/react-query";
import type { FileContentResponse, FilesResponse } from "../types/file";

async function fetchGitTree(taskId: string, sha: string): Promise<FilesResponse> {
  const res = await fetch(`/api/tasks/${taskId}/git/tree?sha=${encodeURIComponent(sha)}`);
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to fetch tree");
  }
  return res.json();
}

async function fetchGitFile(
  taskId: string,
  sha: string,
  path: string,
): Promise<FileContentResponse> {
  const res = await fetch(
    `/api/tasks/${taskId}/git/file?sha=${encodeURIComponent(sha)}&file=${encodeURIComponent(path)}`,
  );
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to fetch file content");
  }
  return res.json();
}

export function useGitTree(taskId: string, sha: string | undefined) {
  return useQuery({
    queryKey: ["git-tree", taskId, sha],
    queryFn: () => fetchGitTree(taskId, sha!),
    enabled: !!sha,
    // A commit's tree is immutable per SHA. Do NOT set gcTime — inactive trees
    // are GC'd on the default schedule so memory stays bounded.
    staleTime: Infinity,
  });
}

export function useGitFile(taskId: string, sha: string | undefined, path: string | null) {
  return useQuery({
    queryKey: ["git-file", taskId, sha, path],
    queryFn: () => fetchGitFile(taskId, sha!, path!),
    enabled: !!sha && path !== null,
    // A blob is immutable per (SHA, path). Do NOT set gcTime.
    staleTime: Infinity,
  });
}
