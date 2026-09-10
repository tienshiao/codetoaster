// What the file routes put on the wire, shared by the server and the frontend
// so the two cannot drift. Both shapes are read by two callers each — the
// project-path field and the composer's `@` completion for a listing, the
// command palette and that same completion for a search hit — which is the
// reason they are here rather than beside either one.

/** One child of a listed directory, as `GET /api/directories?files=1` answers
 * it. A symlink is classified by what it points at, so a link to a directory
 * completes like one. */
export interface DirectoryEntry {
  name: string;
  isDirectory: boolean;
}

/** One fuzzy-match hit, relative to the repository it was searched in.
 * `indices` are the matched character positions in `path`, for the highlight. */
export interface FileSearchResult {
  path: string;
  name: string;
  indices: number[];
}
