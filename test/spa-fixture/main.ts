// A stand-in for the frontend bundle in bundles.test.ts: an HTML import whose
// JS and CSS bundles both sit well above the compression threshold. The text
// is written out rather than generated, so it survives minification.
export const fixtureRows = [
  "row 01: the quick brown fox jumps over the lazy dog while the terminal scrolls",
  "row 02: the quick brown fox jumps over the lazy dog while the diff renders",
  "row 03: the quick brown fox jumps over the lazy dog while the file tree loads",
  "row 04: the quick brown fox jumps over the lazy dog while the commit graph draws",
  "row 05: the quick brown fox jumps over the lazy dog while the task list updates",
  "row 06: the quick brown fox jumps over the lazy dog while the terminal scrolls",
  "row 07: the quick brown fox jumps over the lazy dog while the diff renders",
  "row 08: the quick brown fox jumps over the lazy dog while the file tree loads",
  "row 09: the quick brown fox jumps over the lazy dog while the commit graph draws",
  "row 10: the quick brown fox jumps over the lazy dog while the task list updates",
  "row 11: the quick brown fox jumps over the lazy dog while the terminal scrolls",
  "row 12: the quick brown fox jumps over the lazy dog while the diff renders",
  "row 13: the quick brown fox jumps over the lazy dog while the file tree loads",
  "row 14: the quick brown fox jumps over the lazy dog while the commit graph draws",
  "row 15: the quick brown fox jumps over the lazy dog while the task list updates",
  "row 16: the quick brown fox jumps over the lazy dog while the terminal scrolls",
  "row 17: the quick brown fox jumps over the lazy dog while the diff renders",
  "row 18: the quick brown fox jumps over the lazy dog while the file tree loads",
  "row 19: the quick brown fox jumps over the lazy dog while the commit graph draws",
  "row 20: the quick brown fox jumps over the lazy dog while the task list updates",
  "row 21: the quick brown fox jumps over the lazy dog while the terminal scrolls",
  "row 22: the quick brown fox jumps over the lazy dog while the diff renders",
  "row 23: the quick brown fox jumps over the lazy dog while the file tree loads",
  "row 24: the quick brown fox jumps over the lazy dog while the commit graph draws",
];
console.log(fixtureRows.join("\n"));
void import("./lazy").then(({ lazyMarker }) => console.log(lazyMarker));
