import * as os from "node:os";

/**
 * A path as the user typed it, with a leading `~` resolved.
 *
 * A project's path is stored the way it was written — the field shows `~/…`
 * because that is what the user meant — so everything that has to *reach* it
 * expands first: the task manager before it spawns, and the file routes before
 * they hand a directory to git.
 *
 * Strictly `~` alone or `~/…`. `~foo` is another user's home to a shell and
 * nothing this can resolve, so it is left as it stands rather than turned into
 * a path under our own home that nobody named.
 *
 * `home` is a parameter only so a test can say what home is; every caller in
 * the server takes the process's.
 */
export function expandTilde(path: string, home = os.homedir()): string {
  if (path === "~") return home;
  if (path.startsWith("~/")) return home + path.slice(1);
  return path;
}
