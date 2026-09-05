import { useQuery } from "@tanstack/react-query";

export interface FileSearchResult {
  path: string;
  name: string;
  indices: number[];
}

interface FileSearchResponse {
  results: FileSearchResult[];
}

async function fetchFileSearch(taskId: string, query: string): Promise<FileSearchResponse> {
  const res = await fetch(`/api/tasks/${taskId}/files/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to search files");
  }
  return res.json();
}

/**
 * The palette's file hits for one query.
 *
 * Deliberately without `keepPreviousData`: the rows it feeds are `forceMount`,
 * so they bypass cmdk's filter and can be the pre-selected Enter target — and
 * held over a fetch that has not answered, that target is a file matching the
 * query the user has already finished typing over. An empty section while the
 * request is out, with the palette's footer saying so, is the honest state.
 */
export function useFileSearch(taskId: string | null, query: string) {
  return useQuery({
    queryKey: ["tasks", taskId, "files-search", query],
    queryFn: () => fetchFileSearch(taskId!, query),
    enabled: taskId !== null && query.length > 0,
    staleTime: 30_000,
  });
}
