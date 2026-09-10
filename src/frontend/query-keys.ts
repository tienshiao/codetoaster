/**
 * Every query key the change-invalidation has to be able to name (TASK-103).
 *
 * The invalidation and the hooks must agree on a key down to the last segment
 * — a key that does not match is not an error, it is silence — so the key is
 * built in one place and both sides call the same function. Spelled inline on
 * both sides, as they were, a rename on the hook side turns the invalidation
 * into a no-op that nothing fails on; built here, it is a type error.
 *
 * A `null` id or leaf is not sloppiness: several of these hooks are mounted
 * before there is a task, a file or a query to ask about and are `enabled:
 * false` until there is. The key still has to exist for those renders, and it
 * has to be a *different* key from the one with a value in it, or the disabled
 * observer would share a cache entry with a real fetch.
 *
 * Not here: `git-commit`, `git-tree`, `git-file` and `diff-tokens`. All four
 * are keyed by a content hash, nothing on the other side of this module ever
 * invalidates them, and a hash's content cannot change.
 */

/** Everything under one task's checkout — `["tasks", id, …]`. The prefixes are
 * the same key with the leaf left off: react-query matches by prefix, so one
 * of them stands in for every query below it. */
export const taskKeys = {
  /** use-task-files.ts — the file tree. */
  files: (id: string | null) => ["tasks", id, "files"] as const,
  /** use-task-files.ts — one file's content. */
  file: (id: string | null, path: string | null) => ["tasks", id, "file", path] as const,
  /** Every open file at once, for a change too broad to list. */
  filePrefix: (id: string | null) => ["tasks", id, "file"] as const,
  /** use-task-diff.ts — the working-tree diff. */
  diff: (id: string | null) => ["tasks", id, "diff"] as const,
  /** use-file-search.ts — the palette's file hits for one query. */
  fileSearch: (id: string | null, query: string) => ["tasks", id, "files-search", query] as const,
  fileSearchPrefix: (id: string | null) => ["tasks", id, "files-search"] as const,
  /** use-symbol-lookup.ts — one symbol by name. */
  symbol: (id: string | null, name: string | null) => ["tasks", id, "symbols", name] as const,
  symbolPrefix: (id: string | null) => ["tasks", id, "symbols"] as const,
  /** use-symbol-search.ts — fuzzy symbol search. */
  symbolSearch: (id: string | null, query: string | null) =>
    ["tasks", id, "symbol-search", query] as const,
  symbolSearchPrefix: (id: string | null) => ["tasks", id, "symbol-search"] as const,
  /** use-backlog.ts — the repository's Backlog.md state. */
  backlog: (id: string | null) => ["tasks", id, "backlog"] as const,
};

/** The git views. Keyed by task rather than by repository because that is what
 * the endpoints take; two tasks on the same repo are two caches, and they are
 * two working trees. */
export const gitKeys = {
  /** use-git-log.ts — the infinite commit log. */
  log: (id: string | null) => ["git-log", id] as const,
  /** use-git-refs.ts — branches, tags and HEAD. */
  refs: (id: string | null) => ["git-refs", id] as const,
};
