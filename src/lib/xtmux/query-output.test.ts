import { test, expect } from "bun:test";
import { isOnlyQueries } from "./query-output";

const QUERIES: Array<[name: string, chunk: string]> = [
  ["DECXCPR, as Claude Code polls it", "\x1b[?6n"],
  ["a cursor position report request", "\x1b[6n"],
  ["a status report request", "\x1b[5n"],
  ["a colour-scheme query", "\x1b[?996n"],
  ["a Primary DA", "\x1b[c"],
  ["a Primary DA with its zero", "\x1b[0c"],
  ["a Secondary DA", "\x1b[>c"],
  ["a DEC-private DECRQM", "\x1b[?2026$p"],
  ["an ANSI DECRQM", "\x1b[4$p"],
  ["an XTSMGRAPHICS read", "\x1b[?2;1;0S"],
  ["a window size report request", "\x1b[14t"],
  ["a DECRQSS", "\x1bP$q q\x1b\\"],
  ["a background colour query", "\x1b]11;?\x07"],
  ["a palette query", "\x1b]4;1;?\x1b\\"],
  // fish's opening burst, as pty-queries.test.ts sends it (TASK-83)
  ["fish's opening burst", "\x1b[?u\x1b[>0q\x1b]11;?\x1b\\\x1bP+q544e\x1b\\\x1b[0c"],
];

test.each(QUERIES)("%s is only a query", (_name, chunk) => {
  expect(isOnlyQueries(chunk)).toBe(true);
});

const OUTPUT: Array<[name: string, chunk: string]> = [
  ["plain text", "hello"],
  ["a query after text", "hello\x1b[?6n"],
  ["a query before a redraw", "\x1b[?6n\x1b[?2026h\x1b[H\x1b[K"],
  ["an empty chunk", ""],
  // Neither of these is a question, though each shares a query's final byte.
  ["a cursor restore", "\x1b[u"],
  ["a window resize", "\x1b[8;24;80t"],
];

test.each(OUTPUT)("%s is output", (_name, chunk) => {
  expect(isOnlyQueries(chunk)).toBe(false);
});
