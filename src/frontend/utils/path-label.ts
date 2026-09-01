/**
 * A filesystem path, short enough for a line of chrome (§7.1).
 *
 * Two moves, in this order, and the order is the point: abbreviating the home
 * directory usually makes the path short enough on its own, and eliding first
 * would spend the budget on characters `~` was about to delete anyway.
 *
 * The *tail* survives an elision, never the head. A path answers "where am I",
 * and the answer is in the last segment or two — `…/ct/4b55ec75` says more than
 * `/Users/someone/.codetoaster/…` does. This is the opposite of how a sentence
 * is truncated, and it is why this is not a `truncate` class on a span.
 *
 * Nothing here touches the real path: the caller keeps that for the tooltip, so
 * what is elided is always one hover away.
 */

/** Home as `~`, the way a shell writes it — and the way `/api/directories` and
 * `dirLabel` already do server-side, so the app spells a path one way.
 *
 * `home` is empty for a client that has not been told one yet (it rides the
 * task snapshot), and an empty prefix must not match every path. */
export function tildePath(path: string, home: string): string {
  if (!home) return path;
  const root = home.endsWith("/") ? home.slice(0, -1) : home;
  if (path === root) return "~";
  return path.startsWith(root + "/") ? "~" + path.slice(root.length) : path;
}

/**
 * `path`, shortened to at most `max` characters by dropping whole segments from
 * the *middle* and marking the gap with `…`.
 *
 * Whole segments, not characters: half a directory name is a name that does not
 * exist, and a reader cannot tell a truncation from a directory that is really
 * called `4b55ec`. The first segment is kept as the anchor — `~`, or the root —
 * so the path still says whether it is under home.
 *
 * A single segment longer than `max` is returned intact rather than cut. There
 * is no honest way to shorten it, and the container's own overflow is a better
 * place to lose characters than a function that would be lying about the name.
 */
export function elidePath(path: string, max: number): string {
  if (path.length <= max) return path;

  const segments = path.split("/");
  if (segments.length <= 2) return path;

  // Grow the kept tail one segment at a time, and stop before it stops fitting.
  // The head is whatever the path opens with — "~", or "" for an absolute path,
  // which rejoins as the leading slash.
  const head = segments[0]!;
  const tail: string[] = [];
  for (let i = segments.length - 1; i > 0; i--) {
    const candidate = [head, "…", ...[segments[i]!, ...tail]].join("/");
    if (candidate.length > max && tail.length > 0) break;
    tail.unshift(segments[i]!);
    if (candidate.length > max) break;
  }
  return [head, "…", ...tail].join("/");
}

/** Both, in the order that spends the budget least wastefully. */
export function pathLabel(path: string, home: string, max = 40): string {
  return elidePath(tildePath(path, home), max);
}
