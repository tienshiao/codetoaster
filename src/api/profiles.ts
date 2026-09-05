import { profileCapabilities } from "../lib/agent/profile";
import { taskManager } from "../lib/tasks/manager";

/**
 * What this daemon can run a task on (TASK-89.3).
 *
 * Read-only, and there is no POST beside it: profiles come from the daemon's
 * own configuration and never from an HTTP body, because a profile is a
 * command template and one arriving over the wire would be exactly the raw
 * argv `TASK-42` closed off (`lib/agent/profiles.ts`). The API only ever
 * *names* a profile; this route is how a client learns which names there are.
 *
 * The list is served rather than compiled into the client for the same reason:
 * `profiles.json` can add one, and a composer offering a hard-coded list would
 * both miss those and go on offering a built-in that a later release dropped.
 *
 * Names, labels and capabilities — not the templates. The argv is the daemon's
 * business, and the client's only questions about a profile are what to call
 * it and what to stop asking it for: a profile that takes no model gets its
 * model control disabled rather than a flag silently dropped at the spawn.
 */
export const profileRoutes = {
  "/api/profiles": {
    GET() {
      return Response.json(
        taskManager.listProfiles().map((profile) => ({
          name: profile.name,
          label: profile.label,
          capabilities: profileCapabilities(profile),
        })),
      );
    },
  },
};
