/**
 * Whether a chunk of PTY output is nothing but chatter: questions to the
 * terminal and notifications through it.
 *
 * Activity — the sidebar's dot, `last_active_at`, `rank_at`, degraded-mode
 * busy/idle — is inferred from output, and neither a query nor a notification
 * is the program doing anything. Claude Code polls DECXCPR (`CSI ? 6 n`) about
 * every 200ms for as long as it runs, idle or not, which under a 300ms
 * debounce held every agent permanently active; the only edges left were the
 * ones a server stall made, and those landed on every task at once, so an
 * agent untouched for days was stamped as recent as the one actually working
 * (TASK-111).
 *
 * Notifications are the same mistake on a slower clock. Claude Code's idle
 * notification arrives about 60 seconds after its prompt went quiet — as an
 * OSC 9, 777 or 99, or a bare BEL — and counted as output it was a rising edge
 * after a full window of silence, which is exactly what reranks a task
 * (TASK-116): an agent nobody touched jumped to the top of the list for having
 * finished a minute ago. The notification itself is unaffected: `pty.ts` feeds
 * every chunk to the headless terminal before asking this, and its OSC
 * handlers are what raise `onNotification`.
 *
 * The queries are the requests a program sends to learn about its terminal —
 * the ones `pty.ts` and `inline-images.ts` answer, and the probes fish opens
 * with that nothing here answers. None of the set paints a cell. A chunk that
 * mixes one with real output is output, so this only ever matches the whole
 * chunk.
 */

const ST = "(?:\\x07|\\x1b\\\\)";

const CHATTER = [
  // --- Queries ---
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
  // --- Notifications ---
  // OSC 9 (iTerm2 / ConEmu), OSC 777 (notify;title;body), OSC 99 (kitty),
  // the three `pty.ts` turns into desktop notifications. The payload is
  // anything short of a terminator. That takes in ConEmu's other OSC 9
  // sub-commands too (`9;4` progress and the like), none of which paints.
  "\\x1b\\](?:9|777|99);[^\\x1b\\x07]*" + ST,
  // A bare BEL. As a terminator it is consumed by the OSC/DCS patterns above,
  // so this only matches one standing on its own.
  "\\x07",
].join("|");

const ONLY_CHATTER = new RegExp(`^(?:${CHATTER})+$`);

export function isOnlyChatter(chunk: string): boolean {
  return ONLY_CHATTER.test(chunk);
}
