import { useQuery } from "@tanstack/react-query";
import type { GitRefsResponse } from "../types/git";

async function fetchGitRefs(sessionId: string): Promise<GitRefsResponse> {
  const res = await fetch(`/api/sessions/${sessionId}/git/refs`);
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to fetch git refs");
  }
  return res.json();
}

export function useGitRefs(sessionId: string) {
  return useQuery({
    queryKey: ["git-refs", sessionId],
    queryFn: () => fetchGitRefs(sessionId),
    // Refs move out-of-band (commits, checkouts in the terminal). Re-fetch on
    // focus so returning to the tab reflects the current branch/tag state; the
    // global default is false.
    refetchOnWindowFocus: true,
  });
}
