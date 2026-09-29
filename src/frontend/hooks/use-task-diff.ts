import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { parseDiff } from "../utils/parseDiff";
import { enhanceWithWordDiff, type DiffFileTokens } from "../utils/wordDiff";
import { sortFiles } from "../utils/sortFiles";
import { taskKeys } from "../query-keys";
import { refetchOnFocusFor, rootApi, rootId, type RepoRoot } from "../repo-root";
import type { FileDiff } from "../types/diff";

// Fetch server tree-sitter tokens for both sides of each file's diff. This runs
// as its own query (keyed by the diff hash) so the diff paints immediately with
// the client regex fallback and upgrades to tree-sitter tokens when they arrive;
// on any failure/timeout we return null and enhanceWithWordDiff regex-fallbacks.
// With `sha` (git commit view), the server reads new = `git show sha:path`,
// old = `git show sha^1:path`; without it, the working tree / index.
export async function fetchDiffTokens(
  root: RepoRoot,
  files: FileDiff[],
  sha?: string,
): Promise<Map<string, DiffFileTokens> | null> {
  const requestFiles = files
    .filter((f) => !f.isBinary && !f.isImage && !f.oversized)
    .map((f) => ({
      path: f.newPath,
      oldPath: f.oldPath,
      needOld: f.status !== "added",
      needNew: f.status !== "deleted",
    }));
  if (requestFiles.length === 0) return null;

  try {
    const res = await fetch(`${rootApi(root)}/diff-tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sha ? { sha, files: requestFiles } : { files: requestFiles }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { files: Record<string, DiffFileTokens> };
    return new Map(Object.entries(data.files));
  } catch {
    return null;
  }
}

async function fetchDiff(root: RepoRoot): Promise<{ diff: string; hash: string }> {
  const res = await fetch(`${rootApi(root)}/diff`);
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to fetch diff");
  }
  return res.json();
}

export interface TaskDiffOptions {
  enabled?: boolean;
  /**
   * Whether to ask the server for syntax tokens. False for a caller that
   * reads only the file list — the Explorer rail's count, the palette's
   * Changes rows — which would otherwise POST the whole working tree to be
   * tokenized with no diff on screen. Nothing is lost by it: the tokens query
   * is keyed by the diff's content hash with `staleTime: Infinity`, so a
   * Changes panel or diff tab opening later asks for them itself.
   */
  tokens?: boolean;
}

/** One parse per diff response, however many file tabs ask (TASK-121). Keyed
 * by the response object, which react-query hands every observer by identity
 * until a refetch replaces it — and then this entry goes with it. */
const changedPathsCache = new WeakMap<object, Set<string>>();

function changedPaths(response: { diff: string }): Set<string> {
  let paths = changedPathsCache.get(response);
  if (!paths) {
    try {
      paths = new Set(parseDiff(response.diff).map((f) => f.newPath));
    } catch {
      paths = new Set();
    }
    changedPathsCache.set(response, paths);
  }
  return paths;
}

/**
 * The paths in the working-tree diff, for a caller that asks only "has this
 * file changed?" — a file tab's Show changes button.
 *
 * `useTaskDiff` would answer that too, but it word-diffs the whole tree per
 * hook instance, and a file tab per open file is exactly the multiplier that
 * made a large diff freeze the page (TASK-117). This shares its query, so no
 * request of its own, and parses once per response for every tab together.
 */
export function useChangedPaths(root: RepoRoot): Set<string> | undefined {
  const { data } = useQuery({
    queryKey: taskKeys.diff(rootId(root)),
    queryFn: () => fetchDiff(root),
    refetchOnWindowFocus: refetchOnFocusFor(root),
    select: changedPaths,
  });
  return data;
}

// A null root is the Explorer rail or the palette with nothing to read yet: the
// query stays disabled, keyed on `null`, rather than fetching a route with no id.
export function useTaskDiff(
  root: RepoRoot | null,
  { enabled = true, tokens = true }: TaskDiffOptions = {},
) {
  const id = root && rootId(root);
  const diffQuery = useQuery({
    queryKey: taskKeys.diff(id),
    queryFn: () => fetchDiff(root!),
    enabled: enabled && root != null,
    // Unwatched when it is a project root — see `refetchOnFocusFor`.
    refetchOnWindowFocus: refetchOnFocusFor(root),
  });

  // The app has no error boundary, so a throw from parseDiff must degrade like a
  // fetch failure rather than escape the render: catch it and return a sentinel.
  const parsed = useMemo(() => {
    if (!diffQuery.data) return null;
    try {
      return parseDiff(diffQuery.data.diff);
    } catch {
      return "parse-error" as const;
    }
  }, [diffQuery.data]);

  // Tokens are content-addressed on the server and keyed here by the diff hash,
  // so the result is stable for a given diff; never blocks the diff paint below.
  const tokensQuery = useQuery({
    queryKey: ["tasks", id, "diff-tokens", diffQuery.data?.hash],
    queryFn: () => {
      if (!Array.isArray(parsed)) throw new Error("no parsed diff");
      return fetchDiffTokens(root!, parsed);
    },
    enabled: tokens && enabled && root != null && Array.isArray(parsed) && parsed.length > 0,
    staleTime: Infinity,
  });

  const data = useMemo(() => {
    if (!Array.isArray(parsed)) return undefined;
    try {
      // enhanceWithWordDiff recomputes each line's segments from line.content (it
      // never reads prior segments), so re-running it on the same parsed objects
      // when tokens arrive is idempotent — no need to re-parse per pass.
      return sortFiles(enhanceWithWordDiff(parsed, tokensQuery.data ?? undefined));
    } catch {
      // Word-diff enhancement failed: fall back to the raw parsed files, which
      // render fine without per-word segments.
      return parsed;
    }
  }, [parsed, tokensQuery.data]);

  return {
    data,
    isLoading: diffQuery.isLoading,
    error: diffQuery.error ?? (parsed === "parse-error" ? new Error("Failed to parse diff") : null),
    refetch: diffQuery.refetch,
  };
}
