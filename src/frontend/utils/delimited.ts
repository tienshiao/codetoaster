/** A field separator the table preview knows how to split on. */
export type Delimiter = "," | "\t";

/** The delimiter a file's extension implies, or null for a file that is not
 * delimited text. Decided by extension alone: sniffing content would turn a
 * log with a comma in every line into a table. */
export function delimiterForPath(path: string): Delimiter | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot === -1) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  if (ext === "csv") return ",";
  if (ext === "tsv" || ext === "tab") return "\t";
  return null;
}

const QUOTE = 34; // "
const CR = 13;
const LF = 10;

/**
 * Split delimited text into rows of fields, per RFC 4180 and leniently past it.
 *
 * - A field that starts with `"` runs to the matching unescaped `"`, so it may
 *   hold the delimiter, `""` (a literal quote) and line breaks.
 * - A quote anywhere else in a field is literal, and text after a closing quote
 *   is kept rather than rejected: a preview shows a malformed file, it does not
 *   refuse it. An unterminated quote runs to the end of the text.
 * - Rows end at `\n`, `\r\n` or a lone `\r`. A leading BOM is dropped, and a
 *   final line break does not produce an empty last row.
 *
 * TSV gets the same quoting rules: strict TSV has none, but the files people
 * actually have (spreadsheet exports) quote the same way CSV does.
 */
export function parseDelimited(text: string, delimiter: Delimiter): string[][] {
  const delim = delimiter.charCodeAt(0);
  const rows: string[][] = [];
  let row: string[] = [];
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const n = text.length;

  if (i >= n) return rows;

  for (;;) {
    // One field per iteration; `i` is at its first character.
    let field: string;
    if (text.charCodeAt(i) === QUOTE) {
      let out = "";
      let start = i + 1;
      for (;;) {
        const close = text.indexOf('"', start);
        if (close === -1) {
          out += text.slice(start);
          i = n;
          break;
        }
        out += text.slice(start, close);
        if (text.charCodeAt(close + 1) === QUOTE) {
          out += '"';
          start = close + 2;
        } else {
          i = close + 1;
          break;
        }
      }
      // Anything between the closing quote and the next separator is kept.
      const tail = i;
      while (i < n) {
        const c = text.charCodeAt(i);
        if (c === delim || c === LF || c === CR) break;
        i++;
      }
      field = tail < i ? out + text.slice(tail, i) : out;
    } else {
      const start = i;
      while (i < n) {
        const c = text.charCodeAt(i);
        if (c === delim || c === LF || c === CR) break;
        i++;
      }
      field = text.slice(start, i);
    }
    row.push(field);

    if (i >= n) {
      rows.push(row);
      return rows;
    }
    const c = text.charCodeAt(i);
    i++;
    if (c === delim) continue;
    // A line break: close the row.
    if (c === CR && text.charCodeAt(i) === LF) i++;
    rows.push(row);
    row = [];
    if (i >= n) return rows;
  }
}
