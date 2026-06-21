import path from "node:path";
import { sessionManager } from "../lib/xtmux/session-manager";

export async function resolveSessionGitRoot(
  sessionId: string
): Promise<{ dir: string } | { error: Response }> {
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    return { error: Response.json({ error: "Session not found" }, { status: 404 }) };
  }
  const cwd = await session.getCwd();
  if (!cwd) {
    return { error: Response.json({ error: "Cannot determine session CWD" }, { status: 400 }) };
  }
  const gitRootResult = await Bun.$`git -C ${cwd} rev-parse --show-toplevel`.quiet().nothrow();
  if (gitRootResult.exitCode !== 0) {
    return { error: Response.json({ error: "Not a git repository" }, { status: 400 }) };
  }
  return { dir: gitRootResult.text().trim() };
}

export const IMAGE_MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  ico: "image/x-icon",
  bmp: "image/bmp",
  tiff: "image/tiff",
  tif: "image/tiff",
};

export function getImageMimeType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  return IMAGE_MIME_TYPES[ext] || "application/octet-stream";
}

export async function listGitFiles(dir: string, { cached = true }: { cached?: boolean } = {}): Promise<string[]> {
  const result = await Bun.$`git -C ${dir} ls-files -z --others ${cached ? ["--cached"] : []} --exclude-standard`.quiet().nothrow();
  if (result.exitCode !== 0) throw new Error("Failed to list files");
  // -z outputs null-terminated paths, avoiding git's quoting of special characters
  return result.text().split("\0").filter(Boolean);
}

// Diff a single untracked file against /dev/null. Uses Bun.spawn rather than
// Bun.$ because Bun.$ deadlocks when many concurrent shells each buffer large
// stdout (e.g. multi-MB untracked files); streaming the pipe via Response avoids
// it. `git diff --no-index` exits non-zero when files differ, so the exit code
// is intentionally ignored.
export async function diffUntrackedFile(dir: string, file: string): Promise<string> {
  const proc = Bun.spawn(["git", "-C", dir, "diff", "--no-index", "/dev/null", file], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const [text] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return text;
}

export function safePath(dir: string, filePath: string): string | null {
  const resolved = path.resolve(dir, filePath);
  if (!resolved.startsWith(dir + "/")) return null;
  return resolved;
}