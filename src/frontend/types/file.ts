export interface FileInfo {
  path: string;
  name: string;
  isDirectory: boolean;
  size?: number;
  depth: number;
  /** The repository ignores this entry (TASK-130). On a directory it means the
   * listing stops here: its children come from `DirChildrenResponse`. */
  ignored?: true;
}

import type { FileTokens } from "../../types/highlight";
import type { Frontmatter } from "../../types/frontmatter";

export type FileContentResponse =
  | {
      isBinary: true;
      isImage: boolean;
      size?: number;
    }
  | {
      isBinary: false;
      isImage: false;
      lines: { lineNum: number; content: string }[];
      totalLines: number;
      size?: number;
      // Per-line tree-sitter tokens, aligned with `lines`. Null => regex fallback.
      tokens?: FileTokens | null;
      // A markdown file's YAML frontmatter, already shaped (TASK-87). Absent
      // for every other file, and for a block that would not parse to a mapping
      // — which is what tells the preview to render the raw text as before.
      frontmatter?: Frontmatter;
    };

export interface FilesResponse {
  files: FileInfo[];
  directory: string;
}

/** One level of an ignored directory (TASK-130). */
export interface DirChildrenResponse {
  entries: FileInfo[];
  /** How many more the directory holds than the server sent. */
  truncated: number;
}
