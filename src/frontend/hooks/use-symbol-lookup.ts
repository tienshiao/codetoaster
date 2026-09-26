import { useQuery } from "@tanstack/react-query";
import { taskKeys } from "../query-keys";
import { refetchOnFocusFor, rootApi, rootId, type RepoRoot } from "../repo-root";
import type { SymbolLookupResult } from "../../lib/symbols/types";

async function fetchSymbol(root: RepoRoot, name: string): Promise<SymbolLookupResult> {
  const res = await fetch(
    `${rootApi(root)}/symbols?name=${encodeURIComponent(name)}`,
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to look up symbol");
  }
  return res.json();
}

export function useSymbolLookup(root: RepoRoot, name: string | null) {
  return useQuery({
    queryKey: taskKeys.symbol(rootId(root), name),
    queryFn: () => fetchSymbol(root, name!),
    enabled: !!name,
    staleTime: 5000,
    refetchOnWindowFocus: refetchOnFocusFor(root),
  });
}
