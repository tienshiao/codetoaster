import { useQuery } from "@tanstack/react-query";
import { taskKeys } from "../query-keys";
import { refetchOnFocusFor, rootApi, rootId, type RepoRoot } from "../repo-root";
import type { FileSearchResult } from "@/types/files";

// Re-exported so the palette and the composer's completion keep importing a
// hit's shape from the hook that hands them hits.
export type { FileSearchResult };

interface FileSearchResponse {
  results: FileSearchResult[];
}

export interface FileSearchOptions {
  /**
   * Answer the route's refusals about the *root* — a 400 or 404: no directory,
   * a directory that is gone or is not a repository, an id nobody knows — with
   * no results rather than an error.
   *
   * For the composer's `@` completion, where the user typed a word into a
   * prompt: "nothing to suggest" is the honest rendering, and the composer has
   * nowhere to put an error that would not be in the way. Anything else is a
   * real fault and still throws, rather than looking like a repository with no
   * matching files.
   */
  quietRefusals?: boolean;
}

export async function fetchFileSearch(
  root: RepoRoot,
  query: string,
  { quietRefusals = false }: FileSearchOptions = {},
): Promise<FileSearchResponse> {
  const res = await fetch(`${rootApi(root)}/files/search?q=${encodeURIComponent(query)}`);
  if (quietRefusals && (res.status === 400 || res.status === 404)) return { results: [] };
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to search files");
  }
  return res.json();
}

/**
 * A root's file hits for one query — the palette's, and the composer's `@`
 * completion over the chosen project (with `quietRefusals`). One matcher on
 * the server, so a path suggested in the prompt ranks the way the same query
 * ranks in the palette once the task is open.
 *
 * Deliberately without `keepPreviousData`: the rows it feeds are `forceMount`,
 * so they bypass cmdk's filter and can be the pre-selected Enter target — and
 * held over a fetch that has not answered, that target is a file matching the
 * query the user has already finished typing over. An empty section while the
 * request is out, with the palette's footer saying so, is the honest state.
 */
export function useFileSearch(
  root: RepoRoot | null,
  query: string,
  options: FileSearchOptions = {},
) {
  return useQuery({
    queryKey: taskKeys.fileSearch(root && rootId(root), query),
    queryFn: () => fetchFileSearch(root!, query, options),
    enabled: root !== null && query.length > 0,
    refetchOnWindowFocus: refetchOnFocusFor(root),
    staleTime: 30_000,
  });
}
