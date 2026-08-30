import { CommitDetail } from "@/frontend/components/git/CommitDetail";
import { useRefSets } from "@/frontend/components/git/RefChip";
import { useGitRefs } from "@/frontend/hooks/use-git-refs";
import { useViewState } from "@/frontend/hooks/use-view-state";
import type { ViewRef } from "@/frontend/view-state-store";

interface CommitPaneProps {
  taskId: string;
  /** The `commit:<sha>` slot. */
  view: ViewRef;
  sha: string;
  /** Opening a parent from the header is a new tab, not a navigation inside
   * this one — the commit a tab shows is the commit its key names. */
  onOpenCommit: (sha: string) => void;
}

/**
 * A `commit` tab: one commit, in whichever sub-mode it was last left.
 *
 * Sub-mode and tree selection lived in the URL under v1, where a single git
 * route had to encode which commit it was showing. A tab already says that, so
 * they are plain state here — and per-commit rather than per-view, because two
 * commit tabs open side by side are two independent readings.
 */
export function CommitPane({ taskId, view, sha, onOpenCommit }: CommitPaneProps) {
  const [mode, setMode] = useViewState("commit", view, "mode");
  const [file, setFile] = useViewState("commit", view, "file");
  const refSets = useRefSets(useGitRefs(taskId).data);

  return (
    <CommitDetail
      taskId={taskId}
      view={view}
      sha={sha}
      mode={mode}
      onSelectMode={setMode}
      onSelectCommit={onOpenCommit}
      // `file` only means anything in tree mode; the store keeps the last one
      // so switching away and back reopens it, and every other mode ignores it.
      file={mode === "tree" ? (file ?? undefined) : undefined}
      onSelectFile={(path) => setFile(path)}
      refSets={refSets}
    />
  );
}
