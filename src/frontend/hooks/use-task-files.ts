import { useMemo } from "react";
import { useQueries, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { taskKeys } from "../query-keys";
import { refetchOnFocusFor, rootApi, rootId, type RepoRoot } from "../repo-root";
import { walkIgnored } from "../utils/ignored-files";
import type { DirChildrenResponse, FileContentResponse, FileInfo, FilesResponse } from "../types/file";

async function fetchFiles(root: RepoRoot): Promise<FilesResponse> {
  const res = await fetch(`${rootApi(root)}/files`);
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to fetch files");
  }
  return res.json();
}

async function fetchFileContent(root: RepoRoot, filePath: string): Promise<FileContentResponse> {
  const res = await fetch(`${rootApi(root)}/file?file=${encodeURIComponent(filePath)}`);
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to fetch file content");
  }
  return res.json();
}

/** The root's file tree. A null root — a terminal pane with no task behind
 * it — leaves the query disabled. */
export function useTaskFiles(
  root: RepoRoot | null,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: taskKeys.files(root && rootId(root)),
    queryFn: () => fetchFiles(root!),
    enabled: enabled && root != null,
    refetchOnWindowFocus: refetchOnFocusFor(root),
  });
}

/** The same file tree on demand, for a one-off lookup that should not keep an
 * observer — and its refetches — alive. A fresh cached copy answers at once;
 * a stale or invalidated one (the working tree changed) is refetched first,
 * so the lookup sees a file that was just written. */
export function fetchTaskFiles(queryClient: QueryClient, root: RepoRoot): Promise<FilesResponse> {
  return queryClient.fetchQuery({
    queryKey: taskKeys.files(rootId(root)),
    queryFn: () => fetchFiles(root),
  });
}

async function fetchDirChildren(root: RepoRoot, dir: string): Promise<DirChildrenResponse> {
  const res = await fetch(`${rootApi(root)}/files/children?dir=${encodeURIComponent(dir)}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to list directory");
  }
  return res.json();
}

export interface IgnoredTree {
  /** The listing, with the children of every ignored directory that is open
   * and has answered. */
  files: FileInfo[];
  /** Ignored directories in `files` whose children are not: collapsed, or
   * still on their way. See `pruneSet`. */
  unloaded: ReadonlySet<string>;
  /** What to say under an open ignored directory instead of, or after, its
   * children: that they are loading, could not be read, are none, or were cut. */
  notes: ReadonlyMap<string, string>;
}

const NO_FILES: FileInfo[] = [];

const answerIds = new WeakMap<DirChildrenResponse, number>();
let lastAnswerId = 0;

/** A number that is the same for the same answer object, and 0 for none. */
function answerId(data: DirChildrenResponse | undefined): number {
  if (!data) return 0;
  let id = answerIds.get(data);
  if (id === undefined) {
    id = ++lastAnswerId;
    answerIds.set(data, id);
  }
  return id;
}

/**
 * The file tree with its ignored directories opened (TASK-130).
 *
 * The listing stops at an ignored directory, so this holds one query per such
 * directory the user has expanded and stitches the answers in. A directory is
 * an observer only while it is open: collapsing `node_modules` stops watching
 * it, and nothing under it is ever fetched for a tree that never opened it.
 *
 * Which to ask for is `walkIgnored`'s, read against the cache: a directory
 * inside an ignored one is reachable only once its parent has answered, and
 * that answer arriving is a render of this hook.
 */
export function useIgnoredTree(
  root: RepoRoot,
  base: FileInfo[] | undefined,
  expandedPaths: ReadonlySet<string>,
): IgnoredTree {
  const queryClient = useQueryClient();
  const id = rootId(root);
  const listing = base ?? NO_FILES;

  const { open } = walkIgnored(
    listing,
    expandedPaths,
    (dir) => queryClient.getQueryData<DirChildrenResponse>(taskKeys.dirChildren(id, dir))?.entries,
  );
  const results = useQueries({
    queries: open.map((dir) => ({
      queryKey: taskKeys.dirChildren(id, dir),
      queryFn: () => fetchDirChildren(root, dir),
      refetchOnWindowFocus: refetchOnFocusFor(root),
    })),
  });

  // `useQueries` hands back a new array every render; what the tree is built
  // from only changes when an answer does, or when which directories are asked
  // changes. Not when `expandedPaths` does: that is every click on an ordinary
  // directory, and the tree rebuilds all of its nodes from a new `files`. The
  // ignored directories that are open are all of the set that matters here,
  // and those are `open`.
  //
  // An answer by its identity rather than by when it arrived: a refetch that
  // found nothing new is handed back as the same object, and a build writing
  // into an open `dist` is a refetch per second.
  const stamp = results.map((r, i) => `${open[i]}\0${r.status}\0${answerId(r.data)}`).join("\n");
  return useMemo(() => {
    const byDir = new Map(open.map((dir, i) => [dir, results[i]!]));
    const { files, unloaded } = walkIgnored(listing, new Set(open), (dir) => byDir.get(dir)?.data?.entries);
    const notes = new Map<string, string>();
    for (const [dir, result] of byDir) {
      if (!result.data) {
        notes.set(dir, result.isError ? "Could not read this directory" : "Loading…");
      } else if (result.data.entries.length === 0) {
        notes.set(dir, "Empty");
      } else if (result.data.truncated > 0) {
        notes.set(dir, `${result.data.truncated.toLocaleString()} more not shown`);
      }
    }
    return { files, unloaded, notes };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `open` and `results` by `stamp`: both are new arrays each render
  }, [listing, stamp]);
}

export function useFileContent(root: RepoRoot, filePath: string | null) {
  return useQuery({
    queryKey: taskKeys.file(rootId(root), filePath),
    queryFn: () => fetchFileContent(root, filePath!),
    enabled: filePath !== null,
    refetchOnWindowFocus: refetchOnFocusFor(root),
  });
}

/** Reveal a file in Finder on the daemon's machine (TASK-120). Throws with the
 * most specific thing the server said — `open`'s stderr when there is one, the
 * refusal otherwise — since the caller's toast already says what failed. */
export async function revealFile(root: RepoRoot, filePath: string): Promise<void> {
  const res = await fetch(`${rootApi(root)}/reveal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file: filePath }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || data.error || `The server answered ${res.status}`);
  }
}
