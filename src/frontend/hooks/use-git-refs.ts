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
  });
}
