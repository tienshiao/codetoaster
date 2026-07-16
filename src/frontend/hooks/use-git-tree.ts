import { useQuery } from "@tanstack/react-query";
import type { FileContentResponse, FilesResponse } from "../types/file";

async function fetchGitTree(sessionId: string, sha: string): Promise<FilesResponse> {
  const res = await fetch(`/api/sessions/${sessionId}/git/tree?sha=${encodeURIComponent(sha)}`);
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to fetch tree");
  }
  return res.json();
}

async function fetchGitFile(
  sessionId: string,
  sha: string,
  path: string,
): Promise<FileContentResponse> {
  const res = await fetch(
    `/api/sessions/${sessionId}/git/file?sha=${encodeURIComponent(sha)}&file=${encodeURIComponent(path)}`,
  );
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to fetch file content");
  }
  return res.json();
}

export function useGitTree(sessionId: string, sha: string | undefined) {
  return useQuery({
    queryKey: ["git-tree", sessionId, sha],
    queryFn: () => fetchGitTree(sessionId, sha!),
    enabled: !!sha,
    // A commit's tree is immutable per SHA. Do NOT set gcTime — inactive trees
    // are GC'd on the default schedule so memory stays bounded.
    staleTime: Infinity,
  });
}

export function useGitFile(sessionId: string, sha: string | undefined, path: string | null) {
  return useQuery({
    queryKey: ["git-file", sessionId, sha, path],
    queryFn: () => fetchGitFile(sessionId, sha!, path!),
    enabled: !!sha && path !== null,
    // A blob is immutable per (SHA, path). Do NOT set gcTime.
    staleTime: Infinity,
  });
}
