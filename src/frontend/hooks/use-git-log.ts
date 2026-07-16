import { useInfiniteQuery } from "@tanstack/react-query";
import type { GitLogPage } from "../types/git";

async function fetchGitLog(sessionId: string, skip: number): Promise<GitLogPage> {
  const res = await fetch(`/api/sessions/${sessionId}/git/log?skip=${skip}&limit=200`);
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to fetch git log");
  }
  return res.json();
}

export function useGitLog(sessionId: string) {
  return useInfiniteQuery({
    queryKey: ["git-log", sessionId],
    // pageParam is the number of rows already loaded (the `skip` offset).
    queryFn: ({ pageParam }) => fetchGitLog(sessionId, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.hasMore) return undefined;
      return allPages.reduce((sum, page) => sum + page.commits.length, 0);
    },
  });
}
