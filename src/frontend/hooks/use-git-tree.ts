import { useQuery } from "@tanstack/react-query";
import { rootApi, rootId, type RepoRoot } from "../repo-root";
import type { FileContentResponse, FilesResponse } from "../types/file";

async function fetchGitTree(root: RepoRoot, sha: string): Promise<FilesResponse> {
  const res = await fetch(`${rootApi(root)}/git/tree?sha=${encodeURIComponent(sha)}`);
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to fetch tree");
  }
  return res.json();
}

async function fetchGitFile(
  root: RepoRoot,
  sha: string,
  path: string,
): Promise<FileContentResponse> {
  const res = await fetch(
    `${rootApi(root)}/git/file?sha=${encodeURIComponent(sha)}&file=${encodeURIComponent(path)}`,
  );
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to fetch file content");
  }
  return res.json();
}

export function useGitTree(root: RepoRoot, sha: string | undefined) {
  return useQuery({
    queryKey: ["git-tree", rootId(root), sha],
    queryFn: () => fetchGitTree(root, sha!),
    enabled: !!sha,
    // A commit's tree is immutable per SHA. Do NOT set gcTime — inactive trees
    // are GC'd on the default schedule so memory stays bounded.
    staleTime: Infinity,
  });
}

export function useGitFile(root: RepoRoot, sha: string | undefined, path: string | null) {
  return useQuery({
    queryKey: ["git-file", rootId(root), sha, path],
    queryFn: () => fetchGitFile(root, sha!, path!),
    enabled: !!sha && path !== null,
    // A blob is immutable per (SHA, path). Do NOT set gcTime.
    staleTime: Infinity,
  });
}
