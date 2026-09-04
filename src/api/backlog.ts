import { resolveTaskRoot } from "./utils";
import { readBacklog } from "../lib/backlog/read";

export const backlogRoutes = {
  "/api/tasks/:id/backlog": {
    async GET(req: Request & { params: { id: string } }) {
      try {
        const result = await resolveTaskRoot(req.params.id);
        if ("error" in result) {
          // A task outside a repository has no backlog, which is an answer, not
          // a failure: the client hides the section on `detected: false` and
          // would have to special-case a 400 to reach the same place. An
          // unknown task is still a 404.
          if (result.error.status === 400) return Response.json({ detected: false });
          return result.error;
        }

        return Response.json(await readBacklog(result.repoRoot));
      } catch (error) {
        return Response.json(
          { error: "Failed to read backlog", message: error instanceof Error ? error.message : String(error) },
          { status: 500 }
        );
      }
    },
  },
} as const;
