/**
 * Whether a chunk of PTY output is nothing but questions to the terminal.
 *
 * Activity — the sidebar's dot, `last_active_at`, degraded-mode busy/idle — is
 * inferred from output, and a query is output that is not the program doing
 * anything. Claude Code polls DECXCPR (`CSI ? 6 n`) about every 200ms for as
 * long as it runs, idle or not, which under a 300ms debounce held every agent
 * permanently active; the only edges left were the ones a server stall made,
 * and those landed on every task at once, so an agent untouched for days was
 * stamped as recent as the one actually working (TASK-111).
 *
 * The set is the requests a program sends to learn about its terminal —
 * the ones `pty.ts` and `inline-images.ts` answer, and the probes fish opens
 * with that nothing here answers. None of them paints a cell. A chunk that
 * mixes one with real output is output, so this only ever matches the whole
 * chunk.
 */

const ST = "(?:\\x07|\\x1b\\\\)";

const QUERY = [
  // Primary, Secondary, Tertiary DA: CSI c, CSI > c, CSI = c
  "\\x1b\\[[>=]?[\\d;]*c",
  // DSR / DECDSR: CSI 5 n, CSI 6 n, CSI ? 6 n, CSI ? 996 n
  "\\x1b\\[\\??[\\d;]*n",
  // DECRQM, ANSI and DEC-private: CSI Ps $ p, CSI ? Ps $ p
  "\\x1b\\[\\??[\\d;]*\\$p",
  // XTSMGRAPHICS: CSI ? Pi ; Pa ; Pv S
  "\\x1b\\[\\?[\\d;]*S",
  // Kitty keyboard flags query: CSI ? u
  "\\x1b\\[\\?u",
  // XTVERSION: CSI > q, CSI > 0 q
  "\\x1b\\[>0?q",
  // XTWINOPS size reports: CSI 14 t, CSI 16 t, CSI 18 t
  "\\x1b\\[1[468]t",
  // DECRQSS and XTGETTCAP: DCS $ q Pt ST, DCS + q Pt ST
  "\\x1bP[$+]q[^\\x1b\\x07]*" + ST,
  // Colour queries: OSC 4 ; n ; ? and OSC 10/11/12 ; ?
  "\\x1b\\](?:4;\\d+|1[0-2]);\\?" + ST,
].join("|");

const ONLY_QUERIES = new RegExp(`^(?:${QUERY})+$`);

export function isOnlyQueries(chunk: string): boolean {
  return ONLY_QUERIES.test(chunk);
}
