import { useQuery } from "@tanstack/react-query";
import { parseDiff } from "../utils/parseDiff";
import { enhanceWithWordDiff } from "../utils/wordDiff";
import { sortFiles } from "../utils/sortFiles";
import type { FileDiff } from "../types/diff";

async function fetchDiff(sessionId: string): Promise<FileDiff[]> {
  const res = await fetch(`/api/sessions/${sessionId}/diff`);
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to fetch diff");
  }
  const data = await res.json();
  const parsed = parseDiff(data.diff);
  return sortFiles(enhanceWithWordDiff(parsed));
}

export function useSessionDiff(sessionId: string) {
  return useQuery({
    queryKey: ["sessions", sessionId, "diff"],
    queryFn: () => fetchDiff(sessionId),
  });
}
