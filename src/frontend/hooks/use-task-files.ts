import { useQuery } from "@tanstack/react-query";
import { taskKeys } from "../query-keys";
import { refetchOnFocusFor, rootApi, rootId, type RepoRoot } from "../repo-root";
import type { FileContentResponse, FilesResponse } from "../types/file";

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

export function useFileContent(root: RepoRoot, filePath: string | null) {
  return useQuery({
    queryKey: taskKeys.file(rootId(root), filePath),
    queryFn: () => fetchFileContent(root, filePath!),
    enabled: filePath !== null,
    refetchOnWindowFocus: refetchOnFocusFor(root),
  });
}

/** Reveal a file in Finder on the daemon's machine (TASK-120). Throws with the
 * server's message, which the caller shows. */
export async function revealFile(root: RepoRoot, filePath: string): Promise<void> {
  const res = await fetch(`${rootApi(root)}/reveal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file: filePath }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Could not show the file in Finder");
  }
}
