import path from "node:path";
import { gitSpawn } from "./git/spawn";

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
  // gitSpawn rather than Bun.$ for the reason spelled out in `git/spawn.ts`: this lists a
  // whole repository, and it is on a per-keystroke path now that the composer
  // and the palette both search through it.
  const { stdout, exitCode } = await gitSpawn(dir, [
    "ls-files",
    "-z",
    "--others",
    ...(cached ? ["--cached"] : []),
    "--exclude-standard",
  ]);
  if (exitCode !== 0) throw new Error("Failed to list files");
  // -z outputs null-terminated paths, avoiding git's quoting of special characters
  return stdout.split("\0").filter(Boolean);
}

/**
 * What `listGitFiles` leaves out: the entries of `dir` the repository ignores
 * (TASK-130). A directory ends in `/` and stands for everything inside it.
 *
 * `--directory` is the point. An ignore rule usually names a directory, and
 * what is under one is the bulk of any checkout — `node_modules`, a build
 * directory, other tasks' worktrees — so git is asked for the directory and
 * never walks into it. That keeps this the size of the ignore file rather than
 * of the disk, and as quick as the listing it sits beside.
 *
 * One shape needs taking back out. For a directory no rule names but which
 * holds nothing except ignored files, git lists the directory *and* the files
 * (`out/` beside `out/a.log`, under `*.log`). That directory is an ordinary
 * one, and reported as ignored it would stand in for the files it was listed
 * for, so an entry that is the parent of another is dropped. `--no-empty-
 * directory` looks like the flag for this and is not: it also drops ignored
 * directories that have files in them.
 */
export async function listIgnoredEntries(dir: string): Promise<string[]> {
  const { stdout, exitCode } = await gitSpawn(dir, [
    "ls-files",
    "-z",
    "--others",
    "--ignored",
    "--exclude-standard",
    "--directory",
  ]);
  if (exitCode !== 0) throw new Error("Failed to list ignored files");
  const entries = stdout.split("\0").filter(Boolean);
  const parents = new Set<string>();
  for (const entry of entries) {
    for (let slash = entry.indexOf("/"); slash >= 0 && slash < entry.length - 1; slash = entry.indexOf("/", slash + 1)) {
      parents.add(entry.slice(0, slash + 1));
    }
  }
  return parents.size === 0 ? entries : entries.filter((entry) => !parents.has(entry));
}

// Both sides are resolved, and the base is resolved for a reason that bites:
// the comparison is a string prefix, so a `dir` carrying a trailing slash —
// `projects.initial_path` is stored as the user typed it, and reaches here as a
// task's cwd — never matches `dir + "/"` and every path under it is refused.
// The containment check is unchanged; it just no longer depends on how the
// caller spelled the directory.
export function safePath(dir: string, filePath: string): string | null {
  const base = path.resolve(dir);
  const resolved = path.resolve(base, filePath);
  if (!resolved.startsWith(base + path.sep)) return null;
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
  /** The repository ignores this entry (TASK-130). On a directory it means the
   * listing stops here: what is inside is asked for separately. */
  ignored?: true;
}

/**
 * Derive a flat file listing (same shape as GET /api/tasks/:id/files) from a
 * set of blob paths. Each parent directory is synthesized once, before the first
 * file living under it; depth is the path's segment count minus one. `size` is
 * omitted — git blobs aren't stat'd.
 *
 * `ignored` is `listIgnoredEntries`' answer, and its entries follow the listed
 * files, flagged. They share the synthesized parents, which are never flagged
 * themselves: a directory is ignored when git names it, not because of what it
 * holds.
 */
export function buildFileListing(paths: string[], ignored: string[] = []): FileInfo[] {
  const dirSet = new Set<string>();
  const files: FileInfo[] = [];
  const addParents = (parts: string[]) => {
    for (let i = 1; i < parts.length; i++) {
      const dirPath = parts.slice(0, i).join("/");
      if (!dirSet.has(dirPath)) {
        dirSet.add(dirPath);
        files.push({ path: dirPath, name: parts[i - 1]!, isDirectory: true, depth: i - 1 });
      }
    }
  };
  for (const relativePath of paths) {
    const parts = relativePath.split("/");
    addParents(parts);
    files.push({
      path: relativePath,
      name: parts[parts.length - 1]!,
      isDirectory: false,
      depth: parts.length - 1,
    });
  }
  for (const entry of ignored) {
    const isDirectory = entry.endsWith("/");
    const relativePath = isDirectory ? entry.slice(0, -1) : entry;
    if (dirSet.has(relativePath)) continue;
    const parts = relativePath.split("/");
    addParents(parts);
    if (isDirectory) dirSet.add(relativePath);
    files.push({
      path: relativePath,
      name: parts[parts.length - 1]!,
      isDirectory,
      depth: parts.length - 1,
      ignored: true,
    });
  }
  return files;
}
