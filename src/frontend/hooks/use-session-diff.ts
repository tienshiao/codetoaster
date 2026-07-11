import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { parseDiff } from "../utils/parseDiff";
import { enhanceWithWordDiff, type DiffFileTokens } from "../utils/wordDiff";
import { sortFiles } from "../utils/sortFiles";
import type { FileDiff } from "../types/diff";

// Fetch server tree-sitter tokens for both sides of each file's diff. This runs
// as its own query (keyed by the diff hash) so the diff paints immediately with
// the client regex fallback and upgrades to tree-sitter tokens when they arrive;
// on any failure/timeout we return null and enhanceWithWordDiff regex-fallbacks.
async function fetchDiffTokens(
  sessionId: string,
  files: FileDiff[],
): Promise<Map<string, DiffFileTokens> | null> {
  const requestFiles = files
    .filter((f) => !f.isBinary && !f.isImage)
    .map((f) => ({
      path: f.newPath,
      oldPath: f.oldPath,
      needOld: f.status !== "added",
      needNew: f.status !== "deleted",
    }));
  if (requestFiles.length === 0) return null;

  try {
    const res = await fetch(`/api/sessions/${sessionId}/diff-tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: requestFiles }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { files: Record<string, DiffFileTokens> };
    return new Map(Object.entries(data.files));
  } catch {
    return null;
  }
}

async function fetchDiff(sessionId: string): Promise<{ diff: string; hash: string }> {
  const res = await fetch(`/api/sessions/${sessionId}/diff`);
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to fetch diff");
  }
  return res.json();
}

export function useSessionDiff(sessionId: string) {
  const diffQuery = useQuery({
    queryKey: ["sessions", sessionId, "diff"],
    queryFn: () => fetchDiff(sessionId),
  });

  const parsed = useMemo(
    () => (diffQuery.data ? parseDiff(diffQuery.data.diff) : null),
    [diffQuery.data],
  );

  // Tokens are content-addressed on the server and keyed here by the diff hash,
  // so the result is stable for a given diff; never blocks the diff paint below.
  const tokensQuery = useQuery({
    queryKey: ["sessions", sessionId, "diff-tokens", diffQuery.data?.hash],
    queryFn: () => fetchDiffTokens(sessionId, parsed ?? []),
    enabled: !!parsed && parsed.length > 0,
    staleTime: Infinity,
  });

  const data = useMemo(() => {
    if (!parsed) return undefined;
    // enhanceWithWordDiff recomputes each line's segments from line.content (it
    // never reads prior segments), so re-running it on the same parsed objects
    // when tokens arrive is idempotent — no need to re-parse per pass.
    return sortFiles(enhanceWithWordDiff(parsed, tokensQuery.data ?? undefined));
  }, [parsed, tokensQuery.data]);

  return {
    data,
    isLoading: diffQuery.isLoading,
    error: diffQuery.error,
    refetch: diffQuery.refetch,
  };
}
