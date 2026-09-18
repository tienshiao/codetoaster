import type { ILink } from "@xterm/xterm";

/**
 * What every link provider over a task's terminals shares: the slice of xterm
 * they read, and the string-index-to-column mapping.
 *
 * They are registered on the grid one by one rather than combined into a single
 * provider — see `XTerminal`'s `linkProviders`, where the reason is that a
 * provider which answers at once must not be made to wait for one that asks the
 * server.
 *
 * DOM-free, like the providers themselves, so a test can hand them a plain
 * object for a buffer.
 */

/** The slice of xterm a provider actually reads. Typed structurally so a test
 * needs no terminal — the real `Terminal` satisfies it. */
export interface LinkLine {
  translateToString(trim?: boolean): string;
  /** Columns in the row. Optional so a test's stand-in line need only translate. */
  length?: number;
  getCell?(x: number): { getChars(): string; getWidth(): number } | undefined;
}

export interface LinkBuffer {
  buffer: {
    active: {
      getLine(y: number): LinkLine | undefined;
    };
  };
}

/**
 * String index → 0-based column, for the row a match was found in.
 *
 * Not the identity it looks like: a double-width cell (CJK, and the emoji an
 * agent writes beside a task id) is one character of the translated string but
 * two columns of the grid, so every match after one on the same line would
 * otherwise be underlined a column or more to its left — and a click on the
 * link itself would miss it. Mirrors what `WebLinksAddon` does for the same
 * reason.
 *
 * Falls back to the identity when the line does not expose its cells, which is
 * only ever a test's stand-in.
 */
export function columnMapper(line: LinkLine): (index: number) => number {
  const { length, getCell } = line;
  if (typeof length !== "number" || typeof getCell !== "function") return (index) => index;

  const columns: number[] = [];
  for (let x = 0; x < length; x++) {
    const cell = getCell.call(line, x);
    if (!cell) break;
    // Width 0 is the right half of a wide character: no string of its own.
    if (cell.getWidth() === 0) continue;
    // An empty cell translates to one space, so it still consumes one index.
    const count = cell.getChars().length || 1;
    for (let n = 0; n < count; n++) columns.push(x);
  }
  return (index) => columns[index] ?? index;
}

/** xterm's range for `[start, end)` of a translated line on row `y` (1-based):
 * columns are 1-based and the end is inclusive, so the column of the last
 * character is already the 1-based end. */
export function linkRange(
  columnOf: (index: number) => number,
  start: number,
  end: number,
  y: number,
): ILink["range"] {
  return {
    start: { x: columnOf(start) + 1, y },
    end: { x: columnOf(end - 1) + 1, y },
  };
}
