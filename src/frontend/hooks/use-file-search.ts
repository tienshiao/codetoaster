import { useQuery, keepPreviousData } from "@tanstack/react-query";

export interface FileSearchResult {
  path: string;
  name: string;
  indices: number[];
}

interface FileSearchResponse {
  results: FileSearchResult[];
}

async function fetchFileSearch(sessionId: string, query: string): Promise<FileSearchResponse> {
  const res = await fetch(`/api/sessions/${sessionId}/files/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to search files");
  }
  return res.json();
}

export function useFileSearch(sessionId: string | null, query: string) {
  return useQuery({
    queryKey: ["sessions", sessionId, "files-search", query],
    queryFn: () => fetchFileSearch(sessionId!, query),
    enabled: sessionId !== null && query.length > 0,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}
