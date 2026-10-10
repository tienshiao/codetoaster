import type { FileInfo, FilesResponse } from "../types/file";

/**
 * Ignored files in the listing (TASK-130).
 *
 * The file list names what the repository ignores but stops at an ignored
 * directory: `node_modules` is one entry, not thirty thousand. What is inside
 * arrives a directory at a time, as each is opened in the tree. The decisions
 * that follow from that shape are here, DOM-free and query-free so they can be
 * tested as functions: which directories to ask for, what the tree holds once
 * some have answered, and which it still cannot see into.
 */

/** `a/b/c.ts` → `a/b`; `""` for a path at the root. */
export function parentDir(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

/** Whether `path` is strictly inside one of `dirs`, on whole segments. */
export function isUnder(path: string, dirs: Iterable<string>): boolean {
  for (const dir of dirs) {
    if (path.startsWith(`${dir}/`)) return true;
  }
  return false;
}

/** The ignored entries a listing names. */
export interface ListedIgnored {
  /** The directories — the ones the listing stops at. */
  dirs: readonly string[];
  files: ReadonlySet<string>;
}

const listedIgnored = new WeakMap<FilesResponse, ListedIgnored>();

/**
 * The ignored entries of a listing, or undefined before it has arrived. Built
 * once per response, as `filePathSet` is: the terminal's link provider asks
 * per line, and the query hands every caller the same object until it
 * refetches.
 */
export function ignoredEntriesOf(data: FilesResponse | undefined): ListedIgnored | undefined {
  if (!data) return undefined;
  let listed = listedIgnored.get(data);
  if (!listed) {
    const ignored = data.files.filter((file) => file.ignored);
    listed = {
      dirs: ignored.filter((file) => file.isDirectory).map((file) => file.path),
      files: new Set(ignored.filter((file) => !file.isDirectory).map((file) => file.path)),
    };
    listedIgnored.set(data, listed);
  }
  return listed;
}

export function ignoredDirsOf(data: FilesResponse | undefined): readonly string[] | undefined {
  return ignoredEntriesOf(data)?.dirs;
}

export interface IgnoredWalk {
  /** The listing with the children of every open, answered ignored directory. */
  files: FileInfo[];
  /** The ignored directories to hold a children query for: expanded, and
   * reachable through expanded parents that have answered. Outermost first. */
  open: string[];
  /** The ignored directories in `files` whose children are not: collapsed, or
   * asked for and not yet answered. Nothing here can say what is under one. */
  unloaded: Set<string>;
}

/**
 * Walk the listing down through its expanded ignored directories.
 *
 * `childrenOf` answers from whatever has been fetched, and `undefined` for a
 * directory that has not. A directory is only ever reached through a parent
 * that named it, which is what keeps a stale entry of the expanded set — a
 * directory since deleted, a path that was a file all along — from being
 * asked for: the request would be an error, on every mount.
 */
export function walkIgnored(
  base: FileInfo[],
  expanded: ReadonlySet<string>,
  childrenOf: (dir: string) => FileInfo[] | undefined,
): IgnoredWalk {
  const files = [...base];
  const open: string[] = [];
  const unloaded = new Set<string>();
  // Appending while iterating is the walk: a directory's children are visited
  // after everything already listed, so `open` comes out parents first.
  for (let i = 0; i < files.length; i++) {
    const entry = files[i]!;
    if (!entry.ignored || !entry.isDirectory) continue;
    const children = expanded.has(entry.path) ? childrenOf(entry.path) : undefined;
    if (expanded.has(entry.path)) open.push(entry.path);
    if (children) files.push(...children);
    else unloaded.add(entry.path);
  }
  return { files, open, unloaded };
}
