import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { parseDiff } from "../utils/parseDiff";
import { enhanceWithWordDiff } from "../utils/wordDiff";
import { sortFiles } from "../utils/sortFiles";
import { fetchDiffTokens } from "./use-task-diff";
import { rootApi, rootId, type RepoRoot } from "../repo-root";
import type { GitCommitData, GitCommitResponse } from "../types/git";

async function fetchGitCommit(
  root: RepoRoot,
  sha: string,
  base: string | undefined,
): Promise<GitCommitResponse> {
  const params = new URLSearchParams({ sha });
  if (base) params.set("base", base);
  const res = await fetch(`${rootApi(root)}/git/commit?${params}`);
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to fetch commit");
  }
  return (await res.json()) as GitCommitResponse;
}

// `wantTokens` gates the tree-sitter token fetch: tree mode renders no diff, so
// token work is skipped until a diff-rendering mode needs it (the per-sha cache
// key makes the later fetch a one-time cost).
//
// `base` is the commit the diff should be relative to instead of the parent
// (TASK-128): a sha, never a ref name, so the answer is as immutable as the
// commit's own and a ref that moves is a new key rather than a stale entry.
export function useGitCommit(
  root: RepoRoot,
  sha: string | undefined,
  wantTokens = true,
  base?: string,
) {
  const id = rootId(root);
  const commitQuery = useQuery({
    queryKey: ["git-commit", id, sha, base ?? null],
    queryFn: () => fetchGitCommit(root, sha!, base),
    enabled: !!sha,
    // Commit content is immutable per SHA. Do NOT set gcTime — inactive commit
    // queries are GC'd on the default schedule so memory stays bounded.
    staleTime: Infinity,
  });

  const meta = commitQuery.data?.meta;
  const diffBase = commitQuery.data?.diffBase ?? null;
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
  // `git show sha:path` reads. With a `base`, the old side is read from the
  // commit the diff was actually taken from rather than the first parent.
  const tokensQuery = useQuery({
    queryKey: ["git-commit-tokens", id, meta?.hash, commitQuery.data?.hash, base ? diffBase : null],
    queryFn: () => {
      if (!Array.isArray(parsed)) throw new Error("no parsed diff");
      return fetchDiffTokens(root, parsed, meta!.hash, base ? (diffBase ?? undefined) : undefined);
    },
    enabled: wantTokens && Array.isArray(parsed) && parsed.length > 0 && !!meta,
    // Tokens are as immutable as the commit; their absence is not. A null is
    // a timeout or a failure — likelier across a whole branch than across one
    // commit — and the server keeps warming its cache after the client gave
    // up, so the next mount asks again instead of keeping the fallback.
    staleTime: (query) => (query.state.data ? Infinity : 0),
  });

  const data = useMemo<GitCommitData | undefined>(() => {
    if (!Array.isArray(parsed) || !meta) return undefined;
    try {
      // enhanceWithWordDiff recomputes each line's segments from line.content, so
      // re-running it on the same parsed objects when tokens arrive is idempotent:
      // the diff paints with the regex fallback and upgrades in place.
      return { meta, diffBase, files: sortFiles(enhanceWithWordDiff(parsed, tokensQuery.data ?? undefined)) };
    } catch {
      // Word-diff enhancement failed: fall back to the raw parsed files, which
      // render fine without per-word segments.
      return { meta, diffBase, files: parsed };
    }
  }, [parsed, meta, diffBase, tokensQuery.data]);

  return {
    data,
    isLoading: commitQuery.isLoading,
    error:
      commitQuery.error ??
      (parsed === "parse-error" ? new Error("Failed to parse commit diff") : null),
  };
}
