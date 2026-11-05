/**
 * Which lines of `next` are new relative to `prev` (TASK-136): the indices, in
 * `next`, of lines an edit inserted or rewrote.
 *
 * This is what an open file or diff flashes when the agent writes to it, so it
 * answers "where did this change" rather than producing a patch. Three rules
 * follow from that:
 *
 * - The common prefix and suffix are trimmed first. An agent's edit is almost
 *   always one region of a file, so the expensive part only ever sees that
 *   region.
 * - The middle is matched by longest common subsequence while it is small
 *   enough (`maxCells` bounds the table, a few hundred lines a side), which is
 *   what keeps a blank line or a `}` inserted beside identical ones from
 *   flashing its neighbour instead. Past the cap it falls back to counting
 *   lines as a multiset: cheap, and still right for everything that is not a
 *   duplicate.
 * - A pure deletion has no line of its own in `next`, but it happened
 *   somewhere, so the line that now stands where it was is reported — the
 *   only cue there is that something left from there.
 */
export function changedLines(
  prev: readonly string[],
  next: readonly string[],
  maxCells = 250_000,
): number[] {
  const limit = Math.min(prev.length, next.length);
  let start = 0;
  while (start < limit && prev[start] === next[start]) start++;
  let end = 0;
  while (
    end < limit - start &&
    prev[prev.length - 1 - end] === next[next.length - 1 - end]
  ) {
    end++;
  }

  const prevMid = prev.length - start - end;
  const nextMid = next.length - start - end;

  if (nextMid === 0) {
    // Nothing inserted: either nothing changed at all, or lines were removed.
    if (prevMid === 0 || next.length === 0) return [];
    return [Math.min(start, next.length - 1)];
  }
  if (prevMid === 0) return range(start, start + nextMid);

  const marked =
    prevMid * nextMid <= maxCells
      ? unmatchedByLcs(prev, next, start, prevMid, nextMid)
      : unmatchedByCount(prev, next, start, prevMid, nextMid);

  // Every line of the middle matched, so the middle only lost lines (the trim
  // stopped on a removed line whose twin survives further down).
  if (marked.length === 0) return [Math.min(start, next.length - 1)];
  return marked;
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i < to; i++) out.push(i);
  return out;
}

/** Indices of `next`'s middle that no LCS match covers. */
function unmatchedByLcs(
  prev: readonly string[],
  next: readonly string[],
  start: number,
  n: number,
  m: number,
): number[] {
  // table[i][j] = LCS length of prev[start+i..] and next[start+j..], suffix
  // form so the walk below can go forwards.
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        prev[start + i] === next[start + j]
          ? table[(i + 1) * width + j + 1]! + 1
          : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }

  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (j < m) {
    if (i < n && prev[start + i] === next[start + j]) {
      i++;
      j++;
    } else if (i < n && table[(i + 1) * width + j]! >= table[i * width + j + 1]!) {
      i++;
    } else {
      out.push(start + j);
      j++;
    }
  }
  return out;
}

/** Indices of `next`'s middle beyond what `prev`'s middle has of that line. */
function unmatchedByCount(
  prev: readonly string[],
  next: readonly string[],
  start: number,
  n: number,
  m: number,
): number[] {
  const counts = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const line = prev[start + i]!;
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  const out: number[] = [];
  for (let j = 0; j < m; j++) {
    const line = next[start + j]!;
    const left = counts.get(line) ?? 0;
    if (left > 0) counts.set(line, left - 1);
    else out.push(start + j);
  }
  return out;
}
