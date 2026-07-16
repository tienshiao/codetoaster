import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { parseDiff } from "../utils/parseDiff";
import { enhanceWithWordDiff } from "../utils/wordDiff";
import { sortFiles } from "../utils/sortFiles";
import { fetchDiffTokens } from "./use-session-diff";
import type { GitCommitData, GitCommitResponse } from "../types/git";

async function fetchGitCommit(
  sessionId: string,
  sha: string,
): Promise<GitCommitResponse> {
  const res = await fetch(`/api/sessions/${sessionId}/git/commit?sha=${encodeURIComponent(sha)}`);
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to fetch commit");
  }
  return (await res.json()) as GitCommitResponse;
}

// `wantTokens` gates the tree-sitter token fetch: tree mode renders no diff, so
// token work is skipped until a diff-rendering mode needs it (the per-sha cache
// key makes the later fetch a one-time cost).
export function useGitCommit(sessionId: string, sha: string | undefined, wantTokens = true) {
  const commitQuery = useQuery({
    queryKey: ["git-commit", sessionId, sha],
    queryFn: () => fetchGitCommit(sessionId, sha!),
    enabled: !!sha,
    // Commit content is immutable per SHA. Do NOT set gcTime — inactive commit
    // queries are GC'd on the default schedule so memory stays bounded.
    staleTime: Infinity,
  });

  const meta = commitQuery.data?.meta;
  // The app has no error boundary, so a throw from parseDiff must degrade like a
  // fetch failure rather than escape the render: catch it and return a sentinel.
  const parsed = useMemo(() => {
    if (!commitQuery.data) return null;
    try {
      return parseDiff(commitQuery.data.diff);
    } catch {
      return "parse-error" as const;
    }
  }, [commitQuery.data]);

  // Tokens are keyed by the commit's full hash and the diff hash, so the result
  // is stable per commit; never blocks the diff paint below. The full 40-char
  // meta.hash (not the possibly-abbreviated URL sha) drives the server's
  // `git show sha:path` reads.
  const tokensQuery = useQuery({
    queryKey: ["git-commit-tokens", sessionId, meta?.hash, commitQuery.data?.hash],
    queryFn: () => {
      if (!Array.isArray(parsed)) throw new Error("no parsed diff");
      return fetchDiffTokens(sessionId, parsed, meta!.hash);
    },
    enabled: wantTokens && Array.isArray(parsed) && parsed.length > 0 && !!meta,
    staleTime: Infinity,
  });

  const data = useMemo<GitCommitData | undefined>(() => {
    if (!Array.isArray(parsed) || !meta) return undefined;
    try {
      // enhanceWithWordDiff recomputes each line's segments from line.content, so
      // re-running it on the same parsed objects when tokens arrive is idempotent:
      // the diff paints with the regex fallback and upgrades in place.
      return { meta, files: sortFiles(enhanceWithWordDiff(parsed, tokensQuery.data ?? undefined)) };
    } catch {
      // Word-diff enhancement failed: fall back to the raw parsed files, which
      // render fine without per-word segments.
      return { meta, files: parsed };
    }
  }, [parsed, meta, tokensQuery.data]);

  return {
    data,
    isLoading: commitQuery.isLoading,
    error:
      commitQuery.error ??
      (parsed === "parse-error" ? new Error("Failed to parse commit diff") : null),
  };
}
