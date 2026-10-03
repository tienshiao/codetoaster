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
    // `status` marks an answer, as opposed to a request that never got one:
    // see `retry` below.
    throw Object.assign(new Error(data.error || "Failed to fetch commit"), { status: res.status });
  }
  return (await res.json()) as GitCommitResponse;
}

/** What a commit's diff is relative to instead of its parent (TASK-128). */
export interface GitCommitBase {
  /** The ref's commit. What is asked for and cached by: a sha, never a name,
   * so the answer is as immutable as the commit's own and a ref that moves is
   * a new key rather than a stale entry. */
  sha: string;
  /** The ref itself, however the caller names it. Only compared: the same ref
   * at a new sha is the same reading, and keeps its diff on screen meanwhile. */
  ref: string;
}

/** How long a failed token fetch is taken as the answer before a mount asks
 * again. */
const TOKEN_RETRY_MS = 60_000;

// `wantTokens` gates the tree-sitter token fetch: tree mode renders no diff, so
// token work is skipped until a diff-rendering mode needs it (the per-sha cache
// key makes the later fetch a one-time cost).
export function useGitCommit(
  root: RepoRoot,
  sha: string | undefined,
  wantTokens = true,
  base?: GitCommitBase,
) {
  const id = rootId(root);
  const baseRef = base?.ref ?? null;
  const commitQuery = useQuery({
    queryKey: ["git-commit", id, sha, base?.sha ?? null],
    queryFn: () => fetchGitCommit(root, sha!, base?.sha),
    enabled: !!sha,
    // Commit content is immutable per SHA. Do NOT set gcTime — inactive commit
    // queries are GC'd on the default schedule so memory stays bounded.
    staleTime: Infinity,
    // A base ref that moves is a new key, but almost never a new diff: the
    // merge base is where the commit's history left the ref, and commits
    // landing on the ref afterwards do not move it. So the diff taken against
    // the ref's old tip stays up until the new one answers, instead of the
    // pane dropping to a spinner each time someone merges. Only for the same
    // commit and the same ref — a different choice is a different reading.
    meta: { baseRef },
    placeholderData: (previous, previousQuery) =>
      baseRef !== null &&
      previousQuery?.queryKey[1] === id &&
      previousQuery.queryKey[2] === sha &&
      previousQuery.meta?.baseRef === baseRef
        ? previous
        : undefined,
    // The server's own refusals are not worth asking twice: an unknown base is
    // still unknown, and a diff that ran out of time would run out of it again.
    retry: (failures, error) => failures < 1 && !("status" in error),
  });

  const meta = commitQuery.data?.meta;
  const diffBase = commitQuery.data?.diffBase ?? null;
  const diff = commitQuery.data?.diff;
  // The app has no error boundary, so a throw from parseDiff must degrade like a
  // fetch failure rather than escape the render: catch it and return a sentinel.
  // Keyed by the text, so the same diff arriving under a new key is not parsed
  // again.
  const parsed = useMemo(() => {
    if (diff === undefined) return null;
    try {
      return parseDiff(diff);
    } catch {
      return "parse-error" as const;
    }
  }, [diff]);

  // Tokens are keyed by the commit's full hash and the diff hash, so the result
  // is stable per commit; never blocks the diff paint below. The full 40-char
  // meta.hash (not the possibly-abbreviated URL sha) drives the server's
  // `git show sha:path` reads, and `diffBase` names where the old side is read
  // from — the commit the diff on screen was actually taken from.
  const tokensQuery = useQuery({
    queryKey: ["git-commit-tokens", id, meta?.hash, commitQuery.data?.hash, diffBase],
    queryFn: () => {
      if (!Array.isArray(parsed)) throw new Error("no parsed diff");
      return fetchDiffTokens(root, parsed, meta!.hash, diffBase ?? undefined);
    },
    enabled: wantTokens && Array.isArray(parsed) && parsed.length > 0 && !!meta,
    // Tokens are as immutable as the commit; their absence is not. A null is
    // a timeout or a failure — likelier across a whole branch than across one
    // commit — and the server keeps warming its cache after the client gave
    // up, so a later mount asks again. Not every mount: a diff that always
    // times out would start a pass over every file each time the tab showed.
    staleTime: (query) => (query.state.data ? Infinity : TOKEN_RETRY_MS),
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
