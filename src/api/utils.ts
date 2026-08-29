import path from "node:path";
import { taskManager } from "../lib/tasks/manager";

export interface TaskRoot {
  /** The repository the task's work lives in — where every git route runs. */
  repoRoot: string;
  /** The directory the task was started in. Equal to repoRoot for a task
   * opened at the top of its repo, and to the worktree path once §5.6 lands. */
  cwd: string;
}

// Read from the task row, never from a process (§5.4). A suspended task has no
// PTY to interrogate, and browsing a task you are not currently running is the
// whole point — so this asks the row, which also means the data routes stop
// shelling out to `rev-parse --show-toplevel` on every single request.
export function resolveTaskRoot(taskId: string): TaskRoot | { error: Response } {
  const task = taskManager.getTask(taskId);
  if (!task) {
    return { error: Response.json({ error: "Task not found" }, { status: 404 }) };
  }
  // Null when the task's directory is not inside a repository, and every route
  // that reaches this helper needs one.
  if (task.repo_root === null) {
    return { error: Response.json({ error: "Not a git repository" }, { status: 400 }) };
  }
  return { repoRoot: task.repo_root, cwd: task.cwd };
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
export interface GitSpawnOptions {
  // Kill the child if it has not exited within this many milliseconds. git can
  // block indefinitely — a stalled network mount, a contended index.lock — and
  // an abandoned child holds its stdout pipe for the life of the daemon.
  // Racing the promise is not enough: the loser keeps running.
  //
  // A killed child exits 143 (128 + SIGTERM), so the usual `exitCode !== 0`
  // check treats a timeout as a failed lookup without any special casing.
  timeoutMs?: number;
}

export async function gitSpawn(
  dir: string,
  args: string[],
  options?: GitSpawnOptions,
): Promise<{ stdout: string; exitCode: number }> {
  const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "ignore" });
  const timer =
    options?.timeoutMs === undefined ? null : setTimeout(() => proc.kill(), options.timeoutMs);
  try {
    // The kill ends both awaits: stdout hits EOF and exited resolves, so this
    // never outlives the child.
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    return { stdout, exitCode };
  } finally {
    if (timer) clearTimeout(timer);
  }
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
 * Derive a flat file listing (same shape as GET /api/tasks/:id/files) from a
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