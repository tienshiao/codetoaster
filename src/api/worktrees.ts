import * as fsp from "node:fs/promises";
import { liveWorktrees, rootRoutes } from "./roots";

/** One worktree as the Explorer's picker lists it (TASK-138.2). */
export interface WorktreeListEntry {
  /** Absolute, and the realpath: what a worktree token is built from. */
  path: string;
  /** Short branch name, or null for a detached HEAD. */
  branch: string | null;
  head: string;
  /** The checkout the root itself resolves to — the task's own. */
  current: boolean;
}

export const worktreeRoutes = {
  // Every worktree of the root's repository that is there to browse: bare and
  // prunable entries, and any whose directory has gone, are left out, so a
  // worktree removed from disk drops out of the list at once.
  ...rootRoutes("worktrees", {
    async GET({ repoRoot }) {
      try {
        const own = await fsp.realpath(repoRoot).catch(() => repoRoot);
        const worktrees: WorktreeListEntry[] = (await liveWorktrees(repoRoot)).map((w) => ({
          path: w.realPath,
          branch: w.branch,
          head: w.head,
          current: w.realPath === own,
        }));
        return Response.json({ worktrees });
      } catch (error) {
        return Response.json(
          { error: "Failed to list worktrees", message: error instanceof Error ? error.message : String(error) },
          { status: 500 },
        );
      }
    },
  }),
};
