import type { ILink, ILinkProvider } from "@xterm/xterm";
import { columnMapper, linkRange, type LinkBuffer } from "./terminal-links";

/**
 * Commit hashes in a terminal, as links (TASK-110).
 *
 * The third kind after task ids and file paths, and the one that cannot be
 * decided here: those two match against a list the client already holds, while
 * a run of hex is a commit only if the repository says so. So the matcher
 * below is deliberately generous and the resolver has the last word — which is
 * what lets this drop the heuristics a local guess would need. A seven-digit
 * number is a plausible sha (roughly one in twenty-seven is all digits), and
 * rather than weigh that against the `1234567` in a log line, both are simply
 * asked about.
 *
 * DOM-free like its neighbours: the rules about what a sha looks like in prose
 * are testable without a grid, and the provider takes its buffer structurally.
 */

/**
 * Every hex word in one line of terminal text that could be a sha.
 *
 * Seven is git's own abbreviation floor and forty its full length. The
 * boundaries are the ones `backlog-links` uses — no word character and no `-`
 * on either side — and they do most of the filtering for free:
 *
 * - a uuid's `1b24c937-a98f` segments are `-`-joined, so neither is a word;
 * - a longer hash — a 64-char sha-256, a bundle fingerprint — matches nothing
 *   at all, because every window inside it has a hex character on one side;
 * - `#a1b2c3` is six, under the floor, so CSS colours never come up.
 *
 * Lowercase only, because git writes shas that way and uppercase hex in a
 * terminal is nearly always something else — a constant, an address, a dump.
 * What survives all that and still is not a commit is caught by the resolver,
 * at the price of one question.
 */
const SHA = /(?<![\w-])[0-9a-f]{7,40}(?![\w-])/g;

export interface CommitLinkMatch {
  /** 0-based, inclusive. */
  start: number;
  /** 0-based, exclusive. */
  end: number;
  /** The hash as it appeared, which is what the resolver is asked about. */
  sha: string;
}

export function findCommitLinks(text: string): CommitLinkMatch[] {
  return [...text.matchAll(SHA)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    sha: match[0],
  }));
}

/** Candidates per row. A row with more hex words than this is machine output
 * — a table of checksums, a hexdump — and asking about all of them would be
 * the only expensive thing this feature does.
 *
 * Must not exceed `COMMITS_CAP` in `api/git.ts`, which the route enforces with
 * a 400 — and a 400 is not one dead link but a whole row of them, since the
 * request covers every hash on it. The two are not one constant because this
 * file is DOM-free client code and that one is a server module; raise one and
 * raise the other. */
export const ROW_CAP = 32;

/**
 * What the provider needs of the repository: the abbreviations it was handed,
 * mapped to full shas, with anything that is not a commit left out.
 *
 * Two ways in, and the split is not an optimisation — it is what makes these
 * links clickable at all. xterm captures the hovered link on `mousedown` and
 * activates it on `mouseup`, so a provider that has not answered by the time
 * the button goes down has nothing captured and the click is silently lost.
 * `peek` is therefore the path that matters: a row whose hashes are already
 * known answers in the same turn as the hover, exactly as the task-id and
 * file-path providers do, and only a hash nobody has asked about yet takes the
 * asynchronous path.
 */
export interface CommitResolver {
  /** The answers for `shas`, or null if any of them has not been settled yet —
   * the caller must then go the long way round. */
  peek(shas: string[]): ReadonlyMap<string, string> | null;
  resolve(shas: string[]): Promise<ReadonlyMap<string, string>>;
}

/** The one request the resolver makes, taken as an argument so the batching
 * and the memory below can be tested without a server. */
export type CommitFetch = (shas: string[]) => Promise<Record<string, string>>;

export async function fetchCommits(
  taskId: string,
  shas: string[],
): Promise<Record<string, string>> {
  const query = encodeURIComponent(shas.join(","));
  const res = await fetch(`/api/tasks/${taskId}/git/commits?sha=${query}`);
  if (!res.ok) throw new Error("Failed to resolve commits");
  return ((await res.json()) as { commits?: Record<string, string> }).commits ?? {};
}

/**
 * One request per row, and one answer per sha for the life of a task's panes.
 *
 * Remembering a *miss* matters as much as remembering a hit, and is safe for
 * the same reason: a commit never stops being one, and a sha reaches a terminal
 * only after the commit exists, so a hex word that is not a commit now will not
 * quietly become one. What is never remembered is a failed request — a daemon
 * restart, or a task in no repository at all, must not leave every sha it
 * touched permanently unlinkable.
 *
 * `pending` is what stops a second row asking about a sha already in flight: it
 * holds the request covering each sha until that request settles, so two rows
 * mentioning the same commit share one round trip.
 */
export function createCommitResolver(fetchBatch: CommitFetch): CommitResolver {
  const known = new Map<string, string | null>();
  const pending = new Map<string, Promise<unknown>>();

  /** The hits among `shas`, assuming every one of them has been settled. */
  const collect = (shas: string[]) => {
    const commits = new Map<string, string>();
    for (const sha of shas) {
      const full = known.get(sha);
      if (full) commits.set(sha, full);
    }
    return commits;
  };

  return {
    peek: (shas) => (shas.every((sha) => known.has(sha)) ? collect(shas) : null),

    resolve: async (shas) => {
      const waits: Promise<unknown>[] = [];
      const ask: string[] = [];
      for (const sha of shas) {
        if (known.has(sha)) continue;
        const inFlight = pending.get(sha);
        if (inFlight) waits.push(inFlight);
        else ask.push(sha);
      }

      if (ask.length > 0) {
        const request = fetchBatch(ask)
          .then((commits) => {
            for (const sha of ask) known.set(sha, commits[sha] ?? null);
          })
          .finally(() => {
            for (const sha of ask) pending.delete(sha);
          });
        // Recorded before anything awaits, so a row resolving in this same tick
        // joins the request rather than starting its own.
        for (const sha of ask) pending.set(sha, request);
        waits.push(request);
      }

      // A rejection leaves those shas unknown rather than sinking the row: the
      // rest of it still links, and the next hover asks again.
      await Promise.allSettled(waits);
      return collect(shas);
    },
  };
}

/**
 * The xterm provider, registered beside the other two.
 *
 * Alone among them it may have to ask the server, which xterm allows for and
 * `combineLinkProviders` waits on. But it answers in the same turn whenever it
 * can, and that is load-bearing rather than thrifty: an answer that arrives
 * after `mousedown` is an answer xterm never captured, and the click on it goes
 * nowhere. So the first pointer to cross a row carries the round trip — and
 * every hover after it, on any row naming the same commit, is synchronous and
 * clicks like any other link. A row with no hex in it never touches the network
 * at all, which is nearly every row.
 *
 * The link opens the *resolved* sha rather than the text clicked, so the same
 * commit written short in one line and long in another lands on one tab.
 */
export function createCommitLinkProvider(
  terminal: LinkBuffer,
  resolver: CommitResolver,
  onOpen: (sha: string) => void,
): ILinkProvider {
  return {
    provideLinks(y: number, callback: (links: ILink[] | undefined) => void): void {
      // xterm's line number is 1-based; the buffer's is not.
      const line = terminal.buffer.active.getLine(y - 1);
      if (!line) {
        callback(undefined);
        return;
      }
      const text = line.translateToString(true);
      const matches = findCommitLinks(text).slice(0, ROW_CAP);
      if (matches.length === 0) {
        callback(undefined);
        return;
      }

      const columnOf = columnMapper(line);
      const answer = (commits: ReadonlyMap<string, string>) => {
        const links = matches.flatMap<ILink>((match) => {
          const sha = commits.get(match.sha);
          if (!sha) return [];
          return [
            {
              range: linkRange(columnOf, match.start, match.end, y),
              text: match.sha,
              decorations: { pointerCursor: true, underline: true },
              activate: () => onOpen(sha),
            },
          ];
        });
        callback(links.length > 0 ? links : undefined);
      };

      const shas = [...new Set(matches.map((m) => m.sha))];
      const known = resolver.peek(shas);
      if (known) {
        answer(known);
        return;
      }
      resolver.resolve(shas).then(
        (commits) => {
          // The offsets and the column mapping above were taken before the
          // await, and this is the one provider that has one: a row a TUI
          // redraws in place — a progress bar, a spinner, anything repainting
          // at the same absolute buffer row — holds different text by the time
          // the answer lands, and underlining the old offsets would put a link
          // over characters that are not the hash, activating a commit the user
          // cannot see. Re-read the row and offer nothing if it moved on; the
          // answer is remembered either way, so the next hover is synchronous.
          if (terminal.buffer.active.getLine(y - 1)?.translateToString(true) !== text) {
            callback(undefined);
            return;
          }
          answer(commits);
        },
        // A repository that could not answer offers no links this time. The
        // resolver remembers nothing of a failure, so the next hover asks again
        // rather than leaving the row dead for the session.
        () => callback(undefined),
      );
    },
  };
}
