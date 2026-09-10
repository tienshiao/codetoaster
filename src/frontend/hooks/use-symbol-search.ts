import { useQuery } from "@tanstack/react-query";
import { taskKeys } from "../query-keys";
import type { SymbolSearchResult } from "../../lib/symbols/types";

async function fetchSymbolSearch(taskId: string, query: string): Promise<SymbolSearchResult> {
  const res = await fetch(
    `/api/tasks/${taskId}/symbols/search?q=${encodeURIComponent(query)}`,
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to search symbols");
  }
  return res.json();
}

/** Fuzzy/prefix symbol-name search. Pass `null` to disable (e.g. no query). */
export function useSymbolSearch(taskId: string, query: string | null) {
  return useQuery({
    queryKey: taskKeys.symbolSearch(taskId, query),
    queryFn: () => fetchSymbolSearch(taskId, query!),
    enabled: !!query,
    staleTime: 5000,
  });
}
