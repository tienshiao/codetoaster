import { useQuery } from "@tanstack/react-query";
import type { DirectoryEntry } from "@/types/files";

// Re-exported so a component completing paths imports the row shape from the
// hook that hands it the rows, rather than reaching past it to the wire types.
export type { DirectoryEntry };

interface DirResult {
  parent: string;
  directories: string[];
  /** The server's homedir, so a caller can translate between `~` and absolute. */
  home: string;
  /** Files as well as directories, and only for a caller that asked with
   * `files: true` — the path field completes repository paths and would have to
   * filter them straight back out. */
  entries?: DirectoryEntry[];
}

async function fetchDirectories(path: string, files: boolean): Promise<DirResult> {
  const res = await fetch(
    `/api/directories?path=${encodeURIComponent(path)}${files ? "&files=1" : ""}`,
  );
  if (!res.ok) throw new Error("Failed to fetch directories");
  return res.json();
}

export function useDirectories(
  path: string,
  options?: { enabled?: boolean; files?: boolean },
) {
  const files = options?.files ?? false;
  return useQuery({
    // `files` is in the key because it changes the body: two callers listing the
    // same directory want different answers, and the one that asked for files
    // must not be handed the cached listing without them.
    queryKey: ["directories", path, files],
    queryFn: () => fetchDirectories(path, files),
    staleTime: 60_000,
    enabled: options?.enabled ?? true,
  });
}
