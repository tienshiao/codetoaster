import { useQuery } from "@tanstack/react-query";
import type { BacklogResponse } from "../../types/backlog";

async function fetchBacklog(taskId: string): Promise<BacklogResponse> {
  const res = await fetch(`/api/tasks/${taskId}/backlog`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to fetch backlog");
  }
  return res.json();
}

/**
 * The task repository's Backlog.md state (TASK-84): whether it is one, and its
 * task list when it is.
 *
 * One query key for every consumer — the rail asks whether to show the
 * section, the section asks for the list, the terminals ask for the ids they
 * turn into links — so the cache is shared and a refresh by any of them is a
 * refresh for all. `refetchInterval` is per observer: the section polls while
 * it shows and stops when it unmounts, and nothing else has to know.
 */
export function useBacklog(taskId: string | null, options: { refetchInterval?: number | false } = {}) {
  return useQuery({
    queryKey: ["tasks", taskId, "backlog"],
    queryFn: () => fetchBacklog(taskId!),
    enabled: taskId != null,
    refetchInterval: options.refetchInterval ?? false,
  });
}
