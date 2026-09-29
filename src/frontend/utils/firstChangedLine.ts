import type { FileDiff } from "../types/diff";

/**
 * Where "View file" from a diff should land in the new file (TASK-121): the
 * first change, in the order the diff shows them.
 *
 * An added line is its own line number. A deletion has no line in the new file,
 * so it lands on the line that now follows it — which is why the walk tracks
 * the new side through the leading context rather than using `newStart`, the
 * first *context* line, up to three rows above the change.
 *
 * Undefined when there is nothing to point at (a pure rename, a binary file),
 * which opens the file at the top.
 */
export function firstChangedLine(file: FileDiff): number | undefined {
  for (const hunk of file.hunks) {
    let next = hunk.newStart;
    for (const line of hunk.lines) {
      if (line.type === "addition") return line.newLineNum ?? next;
      if (line.type === "deletion") return Math.max(1, next);
      if (line.type === "context") next = (line.newLineNum ?? next) + 1;
    }
  }
  return undefined;
}
