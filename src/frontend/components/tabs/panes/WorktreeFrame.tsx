import type { ReactNode } from "react";
import { FolderGit2 } from "lucide-react";
import type { RepoRoot } from "@/frontend/repo-root";
import { dirName, useRootWorktrees, worktreeName } from "@/frontend/hooks/use-worktrees";

/**
 * A working-tree tab on another worktree of the task's repository
 * (TASK-138.2): the pane, under a line that says which worktree it is.
 *
 * The line names the worktree's branch (its short SHA when detached) and its
 * directory, with the full path a hover away — a file tab on a subagent's
 * checkout looks exactly like one on the task's own otherwise, and the two
 * can be open side by side.
 *
 * A worktree that has been removed is said to be gone in place of the pane,
 * rather than left to the pane's own error for a 404. The list is asked
 * afresh each time the tab mounts, so a tab returned to after its worktree
 * went says so without waiting for the poll.
 */
export function WorktreeFrame({
  root,
  worktree,
  children,
}: {
  /** The task's (or project's) root — the worktree's base. */
  root: RepoRoot;
  worktree: string;
  children: ReactNode;
}) {
  const { data } = useRootWorktrees(root);
  const entry = data?.worktrees.find((w) => w.path === worktree);
  const gone = data !== undefined && entry === undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="flex h-row flex-none items-center gap-1.5 border-b border-border bg-chrome px-3 font-mono text-micro tracking-mono text-muted-foreground"
        title={worktree}
      >
        <FolderGit2 size={12} className="flex-none text-subtle-foreground" />
        <span className="flex-none text-foreground">{entry ? worktreeName(entry) : "worktree"}</span>
        <span className="truncate text-subtle-foreground">{dirName(worktree)}</span>
      </div>
      <div className="min-h-0 flex-1">
        {gone ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
            <p>This worktree no longer exists.</p>
            <p className="font-mono text-micro tracking-mono text-subtle-foreground">{worktree}</p>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
