import { useQuery } from "@tanstack/react-query";
import type { SymbolLookupResult } from "../../lib/symbols/types";

async function fetchSymbol(sessionId: string, name: string): Promise<SymbolLookupResult> {
  const res = await fetch(
    `/api/sessions/${sessionId}/symbols?name=${encodeURIComponent(name)}`,
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to look up symbol");
  }
  return res.json();
}

export function useSymbolLookup(sessionId: string, name: string | null) {
  return useQuery({
    queryKey: ["sessions", sessionId, "symbols", name],
    queryFn: () => fetchSymbol(sessionId, name!),
    enabled: !!name,
    staleTime: 5000,
  });
}
