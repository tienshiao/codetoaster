import { useQuery } from "@tanstack/react-query";
import { parseDiff } from "../utils/parseDiff";
import type { GitCommitData, GitCommitResponse } from "../types/git";

async function fetchGitCommit(sessionId: string, sha: string): Promise<GitCommitData> {
  const res = await fetch(`/api/sessions/${sessionId}/git/commit?sha=${encodeURIComponent(sha)}`);
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to fetch commit");
  }
  const data = (await res.json()) as GitCommitResponse;
  return { meta: data.meta, files: parseDiff(data.diff) };
}

export function useGitCommit(sessionId: string, sha: string | undefined) {
  return useQuery({
    queryKey: ["git-commit", sessionId, sha],
    queryFn: () => fetchGitCommit(sessionId, sha!),
    enabled: !!sha,
    // Commit content is immutable per SHA. Do NOT set gcTime — inactive commit
    // queries are GC'd on the default schedule so memory stays bounded.
    staleTime: Infinity,
  });
}
