import type { ILink, ILinkProvider } from "@xterm/xterm";
import type { FilesResponse } from "../types/file";
import { columnMapper, linkRange, type LinkBuffer } from "./terminal-links";

/**
 * File paths in a terminal, as links (TASK-108).
 *
 * The sibling of `backlog-links.ts`, and DOM-free for the same reason: the
 * rules — what a path looks like in prose, what it resolves against, what is
 * punctuation and what is part of it — are the part worth testing, and none of
 * them needs a grid.
 *
 * Existence is decided against the task's file list, the one the Explorer's
 * Files section already fetches. That makes the check a set lookup: nothing is
 * requested per hover, and the list is refetched when the working tree changes
 * (TASK-103), so a file the agent has just written becomes a link without
 * anyone asking. The cost is that an ignored file — build output,
 * `node_modules` — is never a link, which is the right answer for nearly
 * every path an agent names.
 */

export interface PathLinkIndex {
  /** The task's repository root, absolute, with no trailing slash. */
  root: string;
  /** Every file under it, relative to it. Directories are not links: a file tab
   * has nothing to show for one. */
  files: ReadonlySet<string>;
  /** The same files by their last segment, for a name written without its
   * directory (TASK-109). */
  byName: ReadonlyMap<string, readonly string[]>;
}

/** An index over `root` holding `paths`, each relative to it. */
export function indexPaths(root: string, paths: Iterable<string>): PathLinkIndex {
  const files = new Set<string>();
  const byName = new Map<string, string[]>();
  for (const path of paths) {
    files.add(path);
    const name = path.slice(path.lastIndexOf("/") + 1);
    const same = byName.get(name);
    if (same) same.push(path);
    else byName.set(name, [path]);
  }
  return { root: root.replace(/\/+$/, ""), files, byName };
}

export function indexFiles(data: FilesResponse | undefined): PathLinkIndex | null {
  if (!data) return null;
  return indexPaths(
    data.directory,
    data.files.filter((file) => !file.isDirectory).map((file) => file.path),
  );
}

export interface PathLinkMatch {
  /** 0-based, inclusive. */
  start: number;
  /** 0-based, exclusive. Covers a `:line[:col]` suffix when there is one. */
  end: number;
  /** The link as it appeared in the line. */
  text: string;
  /** Relative to the root — what a file tab takes. One entry for a path that
   * resolves; for a name that only matches the ends of paths, every file it
   * could be, best first (TASK-109). Never empty. */
  paths: string[];
  line?: number;
}

/**
 * The runs a path could be, delimited by what an agent writes around one:
 * whitespace, quotes, backticks, brackets (`Read(src/a.ts)`), markdown
 * emphasis, list separators, and `=` for `--file=src/a.ts`. Trailing sentence
 * punctuation is trimmed afterwards rather than excluded here, because a `.`
 * inside a path is the extension.
 */
const CANDIDATE = /[^\s"'`()[\]{}<>*,;|=]+/g;

const TRAILING = /[.,:;!?]+$/;
const POSITION = /^:(\d+)(?::(\d+))?/;

/** `a/./b/../c` → `a/c`, or null for a path that climbs out of where it
 * started — which is out of the repository, and so not a file of this task. */
function normalize(path: string): string | null {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else {
      out.push(segment);
    }
  }
  return out.length > 0 ? out.join("/") : null;
}

/**
 * The repository-relative paths `raw` names, if it names files of this task.
 *
 * Absolute paths count only inside the root: a worktree task's agent can
 * still print the main checkout's paths, and those are not this task's files.
 * Relative paths are tried against the task's cwd first — what the agent's
 * shell would resolve them against, which is a subdirectory for a project
 * pointing below the toplevel (TASK-65) — and then against the root, which is
 * how agents write paths regardless of where they are running. Either way the
 * answer is a single file.
 *
 * Failing both, a relative path is taken as the tail of one (TASK-109):
 * agents write `Composer.tsx` or `panes/TabPane.tsx` and leave the directory
 * to the reader. That can be several files, ordered by `rank`. Two shapes are
 * kept out of it. A path that says where it starts (`./`, `../`) is not a
 * tail. And the last segment must have an extension, because a bare word
 * that happens to be a file somewhere — `build`, `test`, `LICENSE` — is far
 * more often just a word.
 */
function resolve(raw: string, index: PathLinkIndex, cwd: string | null): string[] {
  if (raw.startsWith("/")) {
    if (!raw.startsWith(`${index.root}/`)) return [];
    const path = normalize(raw.slice(index.root.length + 1));
    return path && index.files.has(path) ? [path] : [];
  }
  // The home directory is the daemon's, not something this side can expand.
  if (raw.startsWith("~")) return [];
  const bases = cwd ? [cwd, ""] : [""];
  for (const base of bases) {
    const path = normalize(base ? `${base}/${raw}` : raw);
    if (path && index.files.has(path)) return [path];
  }

  if (raw.startsWith("./") || raw.startsWith("../")) return [];
  const tail = normalize(raw);
  if (!tail) return [];
  const name = tail.slice(tail.lastIndexOf("/") + 1);
  if (!EXTENSION.test(name)) return [];
  const suffix = `/${tail}`;
  const candidates = (index.byName.get(name) ?? []).filter((path) => path.endsWith(suffix));
  return rank(candidates, cwd);
}

/** A dot with something other than a dot after it — `a.ts`, `.env` — so `..`
 * and a trailing `.` are not extensions. */
const EXTENSION = /\.[^.]/;

/** Files under the cwd first, where the agent is working; then the shortest
 * path, the one nearest the root; then by name, so the order is stable. `cwd`
 * is relative to the root, and `""` is the root itself, which holds
 * everything. */
function rank(paths: string[], cwd: string | null): string[] {
  const outside = (path: string) => (cwd && !path.startsWith(`${cwd}/`) ? 1 : 0);
  return paths.sort(
    (a, b) => outside(a) - outside(b) || a.length - b.length || (a < b ? -1 : a > b ? 1 : 0),
  );
}

/** `cwd` relative to the root: `""` at the root, null outside it — where a
 * relative path says nothing about this repository, and only the root is
 * tried. */
function relativeCwd(cwd: string | null | undefined, root: string): string | null {
  if (!cwd) return null;
  const trimmed = cwd.replace(/\/+$/, "");
  if (trimmed === root) return "";
  return trimmed.startsWith(`${root}/`) ? trimmed.slice(root.length + 1) : null;
}

/**
 * Every existing file named in one line of terminal text.
 *
 * A `:line` or `:line:col` suffix is part of the link and carried as `line`;
 * the column is dropped, since a file tab opens on a line. Anything else after
 * the first colon is not part of the path — `src/a.ts:12-20` links the file
 * and line 12.
 *
 * URLs are skipped outright: the web links addon owns them, and a path inside
 * one (`https://host/src/a.ts`) must not light up a second, shorter link.
 * Task ids need no special case — `TASK-82` is not a file in the list.
 *
 * `@src/a.ts`, the way Claude Code echoes a mention, is matched without the
 * `@` when the name with it is not a file.
 */
export function findPathLinks(
  text: string,
  index: PathLinkIndex,
  cwd?: string | null,
): PathLinkMatch[] {
  const base = relativeCwd(cwd, index.root);
  const matches: PathLinkMatch[] = [];
  for (const candidate of text.matchAll(CANDIDATE)) {
    let token = candidate[0];
    let start = candidate.index;
    if (token.includes("://")) continue;
    token = token.replace(TRAILING, "");

    const colon = token.indexOf(":");
    let raw = colon < 0 ? token : token.slice(0, colon);
    const position = colon < 0 ? null : POSITION.exec(token.slice(colon));
    if (!raw) continue;

    let paths = resolve(raw, index, base);
    if (paths.length === 0 && raw.startsWith("@") && raw.length > 1) {
      paths = resolve(raw.slice(1), index, base);
      if (paths.length > 0) {
        raw = raw.slice(1);
        start += 1;
      }
    }
    if (paths.length === 0) continue;

    const end = start + raw.length + (position ? position[0].length : 0);
    matches.push({
      start,
      end,
      text: text.slice(start, end),
      paths,
      ...(position ? { line: Number(position[1]) } : {}),
    });
  }
  return matches;
}

export interface PathLinkContext {
  index: PathLinkIndex;
  /** The task's cwd, absolute. */
  cwd: string | null;
}

/**
 * The xterm provider, registered beside the web links addon and the backlog
 * provider.
 *
 * The context arrives through `getContext()` for the reason the backlog
 * provider's index does: the registration outlives any one file list and any
 * one cwd, so it reads the current ones per call. Activation is the same plain
 * click every other link in the grid takes; `onOpen` is handed every candidate
 * and the click, and decides whether that is a file to open or a choice to
 * offer at the pointer.
 */
export function createPathLinkProvider(
  terminal: LinkBuffer,
  getContext: () => PathLinkContext | null,
  onOpen: (paths: string[], line: number | undefined, event: MouseEvent) => void,
): ILinkProvider {
  return {
    provideLinks(y: number, callback: (links: ILink[] | undefined) => void): void {
      const context = getContext();
      // xterm's line number is 1-based; the buffer's is not.
      const line = context ? terminal.buffer.active.getLine(y - 1) : undefined;
      if (!context || !line) {
        callback(undefined);
        return;
      }
      const matches = findPathLinks(line.translateToString(true), context.index, context.cwd);
      if (matches.length === 0) {
        callback(undefined);
        return;
      }
      const columnOf = columnMapper(line);
      callback(
        matches.map((match) => ({
          range: linkRange(columnOf, match.start, match.end, y),
          text: match.text,
          decorations: { pointerCursor: true, underline: true },
          activate: (event) => onOpen(match.paths, match.line, event),
        })),
      );
    },
  };
}
