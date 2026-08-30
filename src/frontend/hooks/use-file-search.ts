import { useQuery, keepPreviousData } from "@tanstack/react-query";

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

export function useFileSearch(taskId: string | null, query: string) {
  return useQuery({
    queryKey: ["tasks", taskId, "files-search", query],
    queryFn: () => fetchFileSearch(taskId!, query),
    enabled: taskId !== null && query.length > 0,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}
