import { useQuery } from "@tanstack/react-query";
import { gitKeys } from "../query-keys";
import { rootApi, rootId, type RepoRoot } from "../repo-root";
import type { GitRefsResponse } from "../types/git";

async function fetchGitRefs(root: RepoRoot): Promise<GitRefsResponse> {
  const res = await fetch(`${rootApi(root)}/git/refs`);
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to fetch git refs");
  }
  return res.json();
}

/** A null root leaves the query disabled — the palette at `/` with nothing to
 * read. */
export function useGitRefs(root: RepoRoot | null, enabled = true) {
  return useQuery({
    queryKey: gitKeys.refs(root && rootId(root)),
    queryFn: () => fetchGitRefs(root!),
    enabled: enabled && root != null,
    // Refs move out-of-band (commits, checkouts in the terminal). Re-fetch on
    // focus so returning to the tab reflects the current branch/tag state; the
    // global default is false.
    refetchOnWindowFocus: true,
  });
}
