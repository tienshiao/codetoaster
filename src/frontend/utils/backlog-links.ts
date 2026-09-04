import type { ILink, ILinkProvider } from "@xterm/xterm";
import type { BacklogResponse } from "../../types/backlog";

/**
 * Task ids in a terminal, as links (TASK-86).
 *
 * DOM-free on purpose: the matcher is the part with the rules in it, and a rule
 * about word boundaries should be testable without standing up a grid. The
 * provider below is the only thing here that knows what xterm is, and it takes
 * its buffer structurally so a test can hand it a plain object.
 */

export interface BacklogLinkIndex {
  /** The prefix as ids are written in files — `TASK`, not the config's `task`. */
  prefix: string;
  /** Uppercased id → the task's `.md` path, relative to the repository root.
   * An id absent from here is not a link: it is a task nobody has filed, or one
   * that has moved to `backlog/archive`. */
  paths: ReadonlyMap<string, string>;
}

/** The route's answer, reduced to what a matcher needs. Null outside a
 * Backlog.md repository, which is also how a caller decides to register no
 * provider at all (AC #3). */
export function indexBacklog(data: BacklogResponse | undefined): BacklogLinkIndex | null {
  if (!data || !data.detected) return null;
  const paths = new Map<string, string>();
  for (const task of data.tasks) paths.set(task.id.toUpperCase(), task.path);
  return { prefix: data.prefix, paths };
}

export interface BacklogLinkMatch {
  /** 0-based, inclusive. */
  start: number;
  /** 0-based, exclusive. */
  end: number;
  /** The id exactly as it appeared in the line, lettercase and all. */
  id: string;
  path: string;
}

function escapeRegExp(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every known task id in one line of terminal text.
 *
 * Matched as a whole word — no word character and no `-` on either side — so
 * `TASK-8` does not light up inside `TASK-82` and `xTASK-8` is not an id, while
 * the punctuation an agent actually writes around one (`(TASK-82)`, `TASK-82,`,
 * a sentence ending in `TASK-82.`) still is. Sub-ids (`TASK-82.1`) are part of
 * the id rather than a trailing full stop.
 *
 * Case-insensitive because an agent writes `task-82` as often as `TASK-82`; the
 * lookup is uppercased, since that is the form ids take in files.
 */
export function findBacklogLinks(text: string, index: BacklogLinkIndex): BacklogLinkMatch[] {
  const pattern = new RegExp(
    `(?<![\\w-])${escapeRegExp(index.prefix)}-\\d+(?:\\.\\d+)*(?![\\w-])`,
    "gi",
  );
  const matches: BacklogLinkMatch[] = [];
  for (const match of text.matchAll(pattern)) {
    const id = match[0];
    const path = index.paths.get(id.toUpperCase());
    if (!path) continue;
    matches.push({ start: match.index, end: match.index + id.length, id, path });
  }
  return matches;
}

/** The slice of xterm a provider actually reads. Typed structurally so a test
 * needs no terminal — the real `Terminal` satisfies it. */
export interface BacklogLinkBuffer {
  buffer: {
    active: {
      getLine(y: number): { translateToString(trim?: boolean): string } | undefined;
    };
  };
}

/**
 * The xterm provider, registered beside the web links addon.
 *
 * The index arrives through `getIndex()` rather than by value: a registration
 * lives as long as the grid does, while the task list is polled, so the
 * provider has to read the current list on every call instead of closing over
 * the one that existed when it was registered.
 *
 * Activation is a plain click with no modifier, which is what `WebLinksAddon`
 * is configured for here — the two kinds of link in the same grid must not want
 * different gestures.
 */
export function createBacklogLinkProvider(
  terminal: BacklogLinkBuffer,
  getIndex: () => BacklogLinkIndex | null,
  onOpen: (path: string) => void,
): ILinkProvider {
  return {
    provideLinks(y: number, callback: (links: ILink[] | undefined) => void): void {
      const index = getIndex();
      if (!index) {
        callback(undefined);
        return;
      }
      // xterm's line number is 1-based; the buffer's is not.
      const line = terminal.buffer.active.getLine(y - 1);
      if (!line) {
        callback(undefined);
        return;
      }
      const matches = findBacklogLinks(line.translateToString(true), index);
      if (matches.length === 0) {
        callback(undefined);
        return;
      }
      callback(
        matches.map((match) => ({
          // xterm columns are 1-based and the range's end is inclusive, so an
          // exclusive 0-based end is already the inclusive 1-based one.
          range: { start: { x: match.start + 1, y }, end: { x: match.end, y } },
          text: match.id,
          decorations: { pointerCursor: true, underline: true },
          activate: () => onOpen(match.path),
        })),
      );
    },
  };
}
