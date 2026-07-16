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

// Run git via Bun.spawn (not Bun.$) so large output streams through a pipe
// rather than buffering in a shell — Bun.$ deadlocks when many concurrent shells
// each buffer large stdout (e.g. multi-MB files or patch output).
export async function gitSpawn(dir: string, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "ignore" });
  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { stdout, exitCode };
}

// Raw-bytes variant of gitSpawn for blob content that must not be decoded as
// text (binary detection needs the raw bytes). Same rationale: Bun.spawn (not
// Bun.$) so large output streams through a pipe rather than buffering in a shell.
export async function gitSpawnRaw(dir: string, args: string[]): Promise<{ bytes: Uint8Array; exitCode: number }> {
  const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "ignore" });
  const [buffer, exitCode] = await Promise.all([new Response(proc.stdout).arrayBuffer(), proc.exited]);
  return { bytes: new Uint8Array(buffer), exitCode };
}

// Parse a query param that must be a non-negative integer. Returns the default
// when absent, or null when present-but-invalid (caller responds 400).
export function parseNonNegInt(raw: string | null, def: number): number | null {
  if (raw === null) return def;
  if (!/^\d+$/.test(raw)) return null;
  return parseInt(raw, 10);
}

export const SHA_RE = /^[0-9a-f]{4,40}$/i;

// Diff a single untracked file against /dev/null. `git diff --no-index` exits
// non-zero when files differ, so the exit code is intentionally ignored.
export async function diffUntrackedFile(dir: string, file: string): Promise<string> {
  const { stdout } = await gitSpawn(dir, ["diff", "--no-index", "/dev/null", file]);
  return stdout;
}

export function safePath(dir: string, filePath: string): string | null {
  const resolved = path.resolve(dir, filePath);
  if (!resolved.startsWith(dir + "/")) return null;
  return resolved;
}

// ---------------------------------------------------------------------------
// Tree listing (pure — exported for unit tests)
// ---------------------------------------------------------------------------

export interface FileInfo {
  path: string;
  name: string;
  isDirectory: boolean;
  depth: number;
}

/**
 * Derive a flat file listing (same shape as GET /api/sessions/:id/files) from a
 * set of blob paths. Each parent directory is synthesized once, before the first
 * file living under it; depth is the path's segment count minus one. `size` is
 * omitted — git blobs aren't stat'd.
 */
export function buildFileListing(paths: string[]): FileInfo[] {
  const dirSet = new Set<string>();
  const files: FileInfo[] = [];
  for (const relativePath of paths) {
    const parts = relativePath.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dirPath = parts.slice(0, i).join("/");
      if (!dirSet.has(dirPath)) {
        dirSet.add(dirPath);
        files.push({ path: dirPath, name: parts[i - 1]!, isDirectory: true, depth: i - 1 });
      }
    }
    files.push({
      path: relativePath,
      name: parts[parts.length - 1]!,
      isDirectory: false,
      depth: parts.length - 1,
    });
  }
  return files;
}