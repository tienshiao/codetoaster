import { formatOversizedMarker } from "../lib/diff/oversized";

// The cap on diff payloads (TASK-117).
//
// One modified single-line 22 MB GeoJSON made a 44 MB diff section of nine
// lines, and the client parsed it, word-diffed it, tokenized it and handed the
// browser two 22 MB text nodes — synchronously, in render — until the tab was
// killed. The cap is applied here, before the payload leaves the server, so
// no consumer of the diff routes ever sees such a section.
//
// Three budgets, because they bound different costs:
//
// - `maxFileBytes` bounds one file's payload and render: a file whose diff is a
//   megabyte of ordinary lines is still a megabyte of DOM. One megabyte matches
//   the server tokenizer's own ceiling (`MAX_CONTENT_LENGTH` in
//   `lib/highlight/tokenize.ts`), past which it already declines to highlight.
// - `maxLineChars` bounds the word differ and the tokenizer, whose cost is per
//   line and superlinear in its length: a minified bundle can be well under a
//   megabyte and still hang an O(m·n) LCS over one of its lines. It is measured
//   on the file's content, without the diff's `+`/`-`/` ` prefix.
// - `maxTotalBytes` bounds the whole payload: three hundred files of 900 kB
//   each pass the file budget one by one and still ship 270 MB. Once the files
//   kept so far pass it, every later file with hunks is capped as well,
//   whatever its own size, so the tree and the Changes panel still list them
//   with their counts. The file that crosses the line is kept whole, so the
//   payload stays under `maxTotalBytes + maxFileBytes`.
//
// A capped file keeps its headers — so its path, status and mode survive — and
// has its hunks replaced by one marker line carrying the sizes and the +/-
// counts (`lib/diff/oversized.ts`). Every other file passes through byte for
// byte, and a diff with nothing to cap is returned as the same string.

export const MAX_FILE_DIFF_BYTES = 1_000_000;
export const MAX_DIFF_LINE_CHARS = 20_000;
export const MAX_TOTAL_DIFF_BYTES = 5_000_000;

export interface DiffBudgets {
  maxFileBytes: number;
  maxLineChars: number;
  maxTotalBytes: number;
}

const DEFAULT_BUDGETS: DiffBudgets = {
  maxFileBytes: MAX_FILE_DIFF_BYTES,
  maxLineChars: MAX_DIFF_LINE_CHARS,
  maxTotalBytes: MAX_TOTAL_DIFF_BYTES,
};

const FILE_HEADER = "diff --git ";

/** A counter of the UTF-8 bytes in consecutive, non-overlapping ranges of `s`,
 * taken in order. It does not copy the ranges: a range's byte length is its
 * character count plus what its non-ASCII characters add, and those are found
 * with one native regex scan across the whole string, resumed from call to
 * call — so an all-ASCII diff costs a single scan, and none costs more than
 * one visit per character.
 *
 * Per character: U+0080–U+07FF is two bytes (+1); anything above, a lone
 * surrogate included (encoded as U+FFFD), is three (+2); a surrogate pair is
 * four bytes for two characters (+2 in all). A range must not split a pair,
 * which ranges ending at a newline never do. */
function utf8Counter(s: string): (from: number, to: number) => number {
  const nonAscii = /[^\x00-\x7f]/g;
  // The next non-ASCII character at or after the last range, -1 when there
  // are none left, and -2 before the first scan.
  let next = -2;
  const seek = (at: number) => {
    nonAscii.lastIndex = at;
    const m = nonAscii.exec(s);
    next = m ? m.index : -1;
  };
  return (from, to) => {
    let bytes = to - from;
    if (next === -2 || (next !== -1 && next < from)) seek(from);
    while (next !== -1 && next < to) {
      const c = s.charCodeAt(next);
      if (c < 0x800) {
        bytes += 1;
        seek(next + 1);
      } else {
        bytes += 2;
        const pair = c >= 0xd800 && c <= 0xdbff && next + 1 < s.length && (s.charCodeAt(next + 1) & 0xfc00) === 0xdc00;
        seek(next + (pair ? 2 : 1));
      }
    }
    return bytes;
  };
}

/** One section's measurements, found in a single scan of its lines. */
interface Section {
  start: number;
  end: number;
  /** Offset of the first line starting `@@`, or -1 for a section with no
   * hunks (binary, pure rename, mode change). */
  hunksAt: number;
  /** The longest content line past `hunksAt`, without its prefix, or — for a
   * section with no hunks — the longest line of any kind. */
  longestLine: number;
}

/** The section starting at `start`: every line up to the next that begins
 * `diff --git `. A content line can never start that way — it starts with ` `,
 * `+`, `-` or `\` — so this cannot split inside a hunk. The first section starts
 * at 0 whatever its first line is, so it may hold whatever preceded the first
 * file. Lines are found with `indexOf`, never split: a split would allocate a
 * copy of every line, which is the cost this module exists to avoid on a 44 MB
 * section. */
function scanSection(diff: string, start: number): Section {
  let hunksAt = -1;
  let longestRaw = 0;
  let longestContent = 0;
  let from = start;
  let end = diff.length;
  for (;;) {
    const nl = diff.indexOf("\n", from);
    const lineEnd = nl === -1 ? diff.length : nl;
    const len = lineEnd - from;
    if (len > longestRaw) longestRaw = len;
    const c = diff.charCodeAt(from);
    if (hunksAt === -1) {
      if (c === 64 /* @ */ && diff.startsWith("@@", from)) hunksAt = from;
    } else if ((c === 32 /*   */ || c === 43 /* + */ || c === 45 /* - */) && len - 1 > longestContent) {
      longestContent = len - 1;
    }
    if (nl === -1 || nl + 1 >= diff.length) break;
    from = nl + 1;
    if (diff.startsWith(FILE_HEADER, from)) {
      end = from;
      break;
    }
  }
  return { start, end, hunksAt, longestLine: hunksAt === -1 ? longestRaw : longestContent };
}

/** A section with hunks reduced to its header lines and the marker. */
function capSection(diff: string, { start, end, hunksAt, longestLine }: Section, bytes: number): string {
  // Count + and - lines past the first @@. `+++`/`---` precede it and so are
  // never seen here; a deleted line reading `-- x` is `--- x` and is counted.
  let additions = 0;
  let deletions = 0;
  let from = hunksAt;
  while (from < end) {
    const c = diff.charCodeAt(from);
    if (c === 43 /* + */) additions++;
    else if (c === 45 /* - */) deletions++;
    const nl = diff.indexOf("\n", from);
    if (nl === -1) break;
    from = nl + 1;
  }
  return diff.slice(start, hunksAt) + formatOversizedMarker({ bytes, additions, deletions, longestLine }) + "\n";
}

/** `diff` with every file section over a budget reduced to its headers and an
 * oversized marker. A section with no hunks has nothing to replace and is left
 * as it was. A diff within budget comes back as the same string.
 *
 * One pass over the original string: a section that stays is never sliced,
 * only the runs between capped sections are, and only when something was
 * capped. */
export function capDiff(diff: string, budgets: Partial<DiffBudgets> = {}): string {
  const { maxFileBytes, maxLineChars, maxTotalBytes } = { ...DEFAULT_BUDGETS, ...budgets };
  const bytesOf = utf8Counter(diff);
  const pieces: string[] = [];
  let copiedTo = 0;
  let keptBytes = 0;

  for (let start = 0; start < diff.length; ) {
    const section = scanSection(diff, start);
    const bytes = bytesOf(section.start, section.end);
    const over = bytes > maxFileBytes || section.longestLine > maxLineChars || keptBytes > maxTotalBytes;
    if (over && section.hunksAt !== -1) {
      if (copiedTo < section.start) pieces.push(diff.slice(copiedTo, section.start));
      pieces.push(capSection(diff, section, bytes));
      copiedTo = section.end;
    } else {
      keptBytes += bytes;
    }
    start = section.end;
  }

  if (pieces.length === 0) return diff;
  if (copiedTo < diff.length) pieces.push(diff.slice(copiedTo));
  return pieces.join("");
}
