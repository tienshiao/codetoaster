import { useQuery } from "@tanstack/react-query";
import type { FileSearchResult } from "./use-file-search";

interface FileSearchResponse {
  results: FileSearchResult[];
}

async function fetchProjectFileSearch(
  projectId: string,
  query: string,
): Promise<FileSearchResponse> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/files/search?q=${encodeURIComponent(query)}`,
  );
  // The route's refusals about the *project* — no directory, a directory that
  // is gone or is not a repository, a project id nobody knows — are not
  // failures the user asked about: they typed a word into a prompt, and
  // "nothing to suggest" is the honest rendering, since the composer has
  // nowhere to put an error that would not be in the way. Anything else is a
  // real fault and throws the way the task-scoped hook does, rather than
  // looking to the user like a repository with no matching files.
  if (res.status === 400 || res.status === 404) return { results: [] };
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to search files");
  }
  return res.json();
}

/**
 * A project's files for one query, for the composer's `@` completion.
 *
 * Project-scoped rather than task-scoped because there is no task yet: the
 * prompt is being written. The matcher behind it is the palette's, shared on
 * the server, so a path suggested here ranks the way the same query ranks once
 * the task is open.
 */
export function useProjectFileSearch(projectId: string | undefined, query: string) {
  return useQuery({
    queryKey: ["projects", projectId, "files-search", query],
    queryFn: () => fetchProjectFileSearch(projectId!, query),
    enabled: !!projectId && query.length > 0,
    staleTime: 30_000,
  });
}
