import type { UnarchivePreview } from "@/lib/xtmux/types";
import { calendarDate } from "@/frontend/utils/taskTimes";

/**
 * What unarchiving a task restores, and what it cannot, in sentences
 * (TASK-139).
 *
 * The mirror of `archive-summary.ts`, and pure for the same reason: this is the
 * text that tells a user whether their uncommitted work is coming back, and it
 * should be checkable against inputs rather than only through a dialog.
 *
 * One rule: **say what cannot come back before the button is pressed.** An
 * expired snapshot or a branch recreated from somewhere else loses work, and
 * a dialog that only listed what it restores would let the user find that out
 * from the checkout afterwards.
 */
export function unarchiveSummary(
  preview: UnarchivePreview,
  { formatDate = calendarDate }: { formatDate?: (timestamp: number) => string } = {},
): string[] {
  const { checkout, snapshot, branch, baseRef } = preview;

  if (checkout === "none") {
    // Nothing of ours on disk to rebuild: the task works in the project's own
    // directory, which archiving never touched.
    return ["It runs in the project's own directory, so unarchiving only resumes its agent."];
  }

  const lines: string[] = [];
  const name = branch ?? "its branch";

  switch (checkout) {
    case "restore":
      lines.push(`Its checkout is rebuilt on ${name}.`);
      break;
    case "from-snapshot":
      lines.push(
        `${name} was deleted when it was archived, and is recreated at the commit the snapshot was taken on.`,
      );
      break;
    case "from-remote":
      lines.push(
        `${name} is gone, so it is recreated from origin/${branch}. Commits that were only local are not on it.`,
      );
      break;
    case "from-base":
      lines.push(
        `${name} is gone and nothing else holds it, so it is recreated from ${baseRef ?? "HEAD"}. Its own commits cannot be restored.`,
      );
      break;
  }

  switch (snapshot.state) {
    case "kept":
      lines.push(
        snapshot.stale
          ? `${name} has moved since the snapshot was taken, so its uncommitted work is held back to apply or discard rather than written over the newer commits.`
          : "Its uncommitted work comes back from the snapshot taken when it was archived.",
      );
      break;
    case "expired":
      lines.push(
        snapshot.expiredAt === null
          ? "Its uncommitted work cannot be restored: the snapshot is gone."
          : `Its uncommitted work cannot be restored: the snapshot expired on ${formatDate(snapshot.expiredAt)}.`,
      );
      break;
    case "none":
      // Archive snapshots any checkout it finds on disk, so this is a task
      // whose checkout was already gone when it was archived.
      lines.push("No snapshot was kept, so the checkout comes back with no uncommitted changes.");
      break;
  }

  lines.push("Its agent then resumes.");
  return lines;
}
