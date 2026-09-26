// The line the server puts in place of an oversized file's hunks (TASK-117).
//
// Import-free: the server writes it (`api/diff-cap.ts`) and the client's
// `parseDiff` reads it, and both bundles import this one module.
//
// Why a marker line rather than dropping the file: the file must stay in the
// tree and the Changes panel with its +/- counts, and the only place those
// counts are known is the server, which has the hunks it is throwing away.
// Carrying them on one line inside the file's section keeps the payload an
// ordinary unified diff: every header the parser needs for paths and status
// (`diff --git`, `---`, `+++`, rename lines) is still there.
//
// Why it sits where the hunks would: a client that predates the marker only
// reads lines inside a hunk as content and skips unknown lines outside one, so
// an old client shows the file with no hunks — "Empty file" rather than a
// 44 MB freeze. It degrades; it does not break.

export interface OversizedStats {
  /** Size of the file's section of the diff, in UTF-8 bytes. */
  bytes: number;
  additions: number;
  deletions: number;
  /** The longest line of the file's content in the section, in characters,
   * without the diff's `+`/`-`/` ` prefix: the length of a line in the file. */
  longestLine: number;
}

const PREFIX = "Oversized diff omitted: ";

/** The marker line, without a trailing newline. */
export function formatOversizedMarker({ bytes, additions, deletions, longestLine }: OversizedStats): string {
  return `${PREFIX}${bytes} bytes, +${additions} -${deletions}, longest line ${longestLine} chars`;
}

/** Matches exactly one marker line; the groups are bytes, additions,
 * deletions and longest line. */
export const OVERSIZED_MARKER = /^Oversized diff omitted: (\d+) bytes, \+(\d+) -(\d+), longest line (\d+) chars$/;

/** The numbers a marker line carries, or null for any other line. */
export function parseOversizedMarker(line: string): OversizedStats | null {
  // Cheap reject first: the parser calls this on every line outside a hunk.
  if (!line.startsWith(PREFIX)) return null;
  const m = OVERSIZED_MARKER.exec(line);
  if (!m) return null;
  return {
    bytes: Number(m[1]),
    additions: Number(m[2]),
    deletions: Number(m[3]),
    longestLine: Number(m[4]),
  };
}
