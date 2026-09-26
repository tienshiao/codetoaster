import { rootRoutes } from "./utils";
import { readBacklog } from "../lib/backlog/read";

export const backlogRoutes = {
  ...rootRoutes(
    "backlog",
    {
      async GET({ repoRoot }) {
        try {
          return Response.json(await readBacklog(repoRoot));
        } catch (error) {
          return Response.json(
            { error: "Failed to read backlog", message: error instanceof Error ? error.message : String(error) },
            { status: 500 }
          );
        }
      },
    },
    {
      // A task outside a repository, or a project with no directory or one
      // that is not a repository, has no backlog — an answer, not a failure:
      // the client hides the section on `detected: false` and would have to
      // special-case a 400 to reach the same place. An unknown id is still a
      // 404.
      onResolveError: (error) => (error.status === 400 ? Response.json({ detected: false }) : error),
    },
  ),
};
