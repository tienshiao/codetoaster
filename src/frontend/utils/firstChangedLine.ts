import type { FileDiff } from "../types/diff";

/**
 * Where "View file" from a diff should land in the new file (TASK-121): the
 * first added line, since that is the change the reader was looking at.
 *
 * A hunk that only deletes has no added line to point at, so it falls back to
 * where the hunk sits in the new file — the line the deletion now sits above.
 * Undefined when there is nothing to point at (a pure rename, a binary file),
 * which opens the file at the top.
 */
export function firstChangedLine(file: FileDiff): number | undefined {
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type === "addition" && line.newLineNum !== undefined) return line.newLineNum;
    }
    if (hunk.lines.some((l) => l.type === "deletion")) return Math.max(1, hunk.newStart);
  }
  return undefined;
}
