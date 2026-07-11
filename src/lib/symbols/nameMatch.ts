// Fuzzy/prefix scorer for symbol names. A name-oriented cousin of the path
// matcher in src/api/files.ts: `query` must be a case-insensitive subsequence of
// `name`, and matches are rewarded for landing on word boundaries (start,
// camelCase humps, and after separators) and for contiguous runs. Returns null
// when `query` isn't a subsequence at all. Higher score = better match.

const SEPARATOR = /[_\-.$/]/;

/** `lowerQuery` must already be lowercased (hoisted out of the per-name loop). */
export function scoreName(name: string, lowerQuery: string): number | null {
  if (lowerQuery.length === 0) return 0;
  const lowerName = name.toLowerCase();
  if (lowerName === lowerQuery) return 10_000; // exact (case-insensitive)

  let qi = 0;
  let score = 0;
  let prevMatch = -2;
  let firstMatch = -1;

  for (let i = 0; i < lowerName.length && qi < lowerQuery.length; i++) {
    if (lowerName[i] !== lowerQuery[qi]) continue;
    if (firstMatch < 0) firstMatch = i;

    let s = 1;
    if (i === prevMatch + 1) s += 3; // contiguous with the previous match

    const ch = name[i]!;
    const prevCh = i > 0 ? name[i - 1]! : "";
    const camelHump = ch >= "A" && ch <= "Z" && !(prevCh >= "A" && prevCh <= "Z");
    if (i === 0 || SEPARATOR.test(prevCh) || camelHump) s += 5; // word boundary

    score += s;
    prevMatch = i;
    qi++;
  }

  if (qi < lowerQuery.length) return null; // not a subsequence
  if (firstMatch === 0) score += 8; // whole-name prefix
  // Mild preference for shorter names among otherwise-equal matches.
  score -= (name.length - lowerQuery.length) * 0.1;
  return score;
}
