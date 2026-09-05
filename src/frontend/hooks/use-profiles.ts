import { useQuery } from "@tanstack/react-query";
import type { ProfileCapabilities } from "../../lib/agent/profile";

/** One row of `GET /api/profiles`: what to call an agent, and what to stop
 * asking it for. The templates stay on the server — the client's business with
 * a profile is its name, its label, and whether a control beside it means
 * anything. */
export interface ProfileSummary {
  name: string;
  label: string;
  capabilities: ProfileCapabilities;
}

async function fetchProfiles(): Promise<ProfileSummary[]> {
  const res = await fetch("/api/profiles");
  if (!res.ok) throw new Error("Failed to fetch agent profiles");
  return res.json();
}

/**
 * Which agents this daemon can run a task on (TASK-89.3).
 *
 * `staleTime: Infinity` because the answer is the daemon's configuration, read
 * once at startup: it cannot change while this page is open without the daemon
 * restarting, and a restart drops the socket and reloads the client anyway.
 *
 * Every consumer has to render before the answer lands. The composer shows a
 * profile select with only "Project default" in it and disables nothing, which
 * is the honest reading of "we have not been told yet" — and is also what the
 * request already means, since an absent field is what the unset choice sends.
 */
export function useProfiles() {
  return useQuery({
    queryKey: ["profiles"],
    queryFn: fetchProfiles,
    staleTime: Infinity,
  });
}
