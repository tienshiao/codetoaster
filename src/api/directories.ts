import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, basename, join } from "node:path";
import { expandTilde } from "../lib/tilde";
import type { DirectoryEntry } from "../types/files";

/** How many names one answer carries, applied to each group on its own: a
 * directory with fifty subdirectories still offers its files, which a ceiling
 * over the concatenation would have eaten. */
const LIMIT = 50;

/**
 * Whether a dirent names a directory, following a symlink to decide.
 *
 * `readdir` reports a symlink as a symlink and nothing more, so a link into a
 * directory would otherwise complete like a file — the token would end in a
 * space and there would be no way to type on into it. A link that points
 * nowhere is a file: `stat` throws on it, and the entry is still worth
 * offering.
 */
async function isDirectoryEntry(dir: string, name: string): Promise<boolean> {
  try {
    return (await stat(join(dir, name))).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The filesystem lister behind the project-path field and the composer's `@`
 * completion.
 *
 * It answers about a *prefix*, not a directory: "~/Pro" lists what is in `~`
 * whose name starts with "Pro", and "~/Projects/" lists what is inside it. The
 * trailing slash is the whole distinction, which is why accepting a suggestion
 * appends one.
 *
 * `files=1` adds `entries` — every non-hidden child, directories first — for
 * the composer, which completes paths to files as well. `parent`,
 * `directories` and `home` are untouched by it, so the path field reads the
 * same answer it always did.
 *
 * A path it cannot read is not an error: the field is typed into character by
 * character and most prefixes name nothing yet. An empty listing with an empty
 * `home` is how that is said, and `DirectoryBrowser` keys off exactly that to
 * tell an unreadable directory from an empty one.
 */
export const directoryRoutes = {
  "/api/directories": {
    async GET(req: Request) {
      const url = new URL(req.url);
      const wantsFiles = url.searchParams.get("files") === "1";
      try {
        const home = homedir();
        let rawPath = expandTilde(url.searchParams.get("path") ?? "", home);

        // Default to home directory
        if (!rawPath) rawPath = home;

        let dirToList: string;
        let prefix = "";

        if (rawPath.endsWith("/")) {
          dirToList = rawPath;
        } else {
          dirToList = dirname(rawPath);
          prefix = basename(rawPath).toLowerCase();
        }

        const dirents = await readdir(dirToList, { withFileTypes: true });
        const visible = dirents.filter(
          (e) =>
            !e.name.startsWith(".") &&
            (!prefix || e.name.toLowerCase().startsWith(prefix)),
        );

        // Only the links are stat'd — a directory of a thousand plain files
        // should not cost a thousand syscalls to answer one prefix — and they
        // are stat'd together rather than one after another.
        const links = visible.filter((e) => e.isSymbolicLink());
        const followed = new Map(
          await Promise.all(
            links.map(
              async (e) => [e.name, await isDirectoryEntry(dirToList, e.name)] as const,
            ),
          ),
        );
        const isDir = (e: (typeof visible)[number]) =>
          e.isSymbolicLink() ? followed.get(e.name) === true : e.isDirectory();

        const sorted = (keep: (e: (typeof visible)[number]) => boolean) =>
          visible
            .filter(keep)
            .map((e) => e.name)
            .sort((a, b) => a.localeCompare(b));

        const directories = sorted(isDir);

        // Replace homedir with ~ for display
        let parent = dirToList.endsWith("/") ? dirToList.slice(0, -1) : dirToList;
        if (parent === home) {
          parent = "~";
        } else if (parent.startsWith(home + "/")) {
          parent = "~" + parent.slice(home.length);
        }

        // Directories first, because typing on into one is the move the list
        // exists for; a file ends the token.
        const entries: DirectoryEntry[] | undefined = wantsFiles
          ? [
              ...directories.slice(0, LIMIT).map((name) => ({ name, isDirectory: true })),
              ...sorted((e) => !isDir(e))
                .slice(0, LIMIT)
                .map((name) => ({ name, isDirectory: false })),
            ]
          : undefined;

        // `entries` is left off entirely for a caller that did not ask, rather
        // than sent as an empty list it would have to tell apart from a
        // directory with no children.
        return Response.json({
          parent,
          directories: directories.slice(0, LIMIT),
          home,
          ...(entries ? { entries } : {}),
        });
      } catch {
        return Response.json({
          parent: "",
          directories: [],
          home: "",
          ...(wantsFiles ? { entries: [] } : {}),
        });
      }
    },
  },
} as const;
