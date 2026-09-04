// A markdown file's YAML frontmatter, already shaped for display (TASK-87).
// Shared by the file-content routes and the frontend, so the two cannot drift.
//
// The values arrive pre-shaped because there is no YAML parser in the frontend
// bundle and there is no reason to put one there: the server knows what each
// value is, so it says so, and the header component is a `switch` over kinds.

export type FrontmatterValue =
  /** A string. */
  | { kind: "text"; text: string }
  /** A number or boolean — same text, but it reads as a machine value. */
  | { kind: "scalar"; text: string }
  /** An array of scalars. */
  | { kind: "list"; items: string[] }
  /** Null, absent, or an empty array: written, but saying nothing. */
  | { kind: "empty" }
  /** Anything nested, re-serialised as YAML for a code block. */
  | { kind: "block"; yaml: string };

export interface FrontmatterEntry {
  key: string;
  value: FrontmatterValue;
}

export interface Frontmatter {
  /** In the file's own key order. */
  entries: FrontmatterEntry[];
  /** Source lines the block spans, both fences included. */
  lineCount: number;
}
