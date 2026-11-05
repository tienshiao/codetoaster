import { useQuery } from "@tanstack/react-query";
import { taskKeys } from "@/frontend/query-keys";
import { rootApi, type RepoRoot } from "@/frontend/repo-root";
import type { ProcessesResponse } from "@/types/processes";

/**
 * How often an open Processes section re-reads the tree (TASK-138.1).
 *
 * Polled because nothing announces a process starting or stopping: the
 * watcher sees files, and the terminal's output says nothing about the
 * children it forks. Two seconds is quick enough that a dev server coming up
 * shows its port while the user is still looking for it, and the section is
 * the only thing that mounts this, so a closed panel costs nothing.
 */
export const PROCESSES_POLL_MS = 2000;

async function fetchProcesses(root: RepoRoot): Promise<ProcessesResponse> {
  const res = await fetch(`${rootApi(root)}/processes`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to read the task's processes");
  }
  return res.json();
}

/** The process tree under a task's terminals. Only a task has terminals: a
 * project root at the composer leaves the query off. */
export function useTaskProcesses(root: RepoRoot | null) {
  const enabled = root?.kind === "task";
  return useQuery({
    queryKey: taskKeys.processes(enabled ? root.id : null),
    queryFn: () => fetchProcesses(root!),
    enabled,
    refetchInterval: PROCESSES_POLL_MS,
  });
}
