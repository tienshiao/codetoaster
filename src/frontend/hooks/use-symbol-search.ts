import { useQuery } from "@tanstack/react-query";
import { taskKeys } from "../query-keys";
import { refetchOnFocusFor, rootApi, rootId, type RepoRoot } from "../repo-root";
import type { SymbolSearchResult } from "../../lib/symbols/types";

async function fetchSymbolSearch(root: RepoRoot, query: string): Promise<SymbolSearchResult> {
  const res = await fetch(
    `${rootApi(root)}/symbols/search?q=${encodeURIComponent(query)}`,
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to search symbols");
  }
  return res.json();
}

/** Fuzzy/prefix symbol-name search. Pass `null` to disable (e.g. no query). */
export function useSymbolSearch(root: RepoRoot, query: string | null) {
  return useQuery({
    queryKey: taskKeys.symbolSearch(rootId(root), query),
    queryFn: () => fetchSymbolSearch(root, query!),
    enabled: !!query,
    staleTime: 5000,
    refetchOnWindowFocus: refetchOnFocusFor(root),
  });
}
