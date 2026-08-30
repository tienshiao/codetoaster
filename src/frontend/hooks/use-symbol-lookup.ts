import { useQuery } from "@tanstack/react-query";
import type { SymbolLookupResult } from "../../lib/symbols/types";

async function fetchSymbol(taskId: string, name: string): Promise<SymbolLookupResult> {
  const res = await fetch(
    `/api/tasks/${taskId}/symbols?name=${encodeURIComponent(name)}`,
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to look up symbol");
  }
  return res.json();
}

export function useSymbolLookup(taskId: string, name: string | null) {
  return useQuery({
    queryKey: ["tasks", taskId, "symbols", name],
    queryFn: () => fetchSymbol(taskId, name!),
    enabled: !!name,
    staleTime: 5000,
  });
}
