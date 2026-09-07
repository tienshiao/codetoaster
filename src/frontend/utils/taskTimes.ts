/**
 * How a task's timestamps are written — in the sidebar row, and in the hover
 * card over it (TASK-97).
 *
 * Milliseconds, because that is what `TaskInfo.createdAt` and `lastActiveAt`
 * carry; `relativeDate.ts` next door speaks unix *seconds* and belongs to git,
 * whose timestamps come off a commit. Two units and one function is how a
 * timestamp ends up a thousand times too old, so they stay apart.
 *
 * Pure and `now`-taking rather than reading the clock: a row's age is computed
 * once per list rebuild, not once per row, and a test has to be able to say
 * what "now" is.
 */

/** Coarse and mono, the way the design wants a timestamp in a 240px row: the
 * list is scanned, not read. One unit, no space, no "ago" — the column is
 * three characters wide. */
export function ago(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/**
 * The same age as a phrase, for a surface with room for one.
 *
 * "just now" under five seconds, because the card is read rather than scanned
 * and "1s ago" is a number pretending to be a measurement — the row keeps
 * counting the seconds, since a moving digit there is what says a task is
 * live.
 */
export function agoLabel(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 5) return "just now";
  return `${ago(timestamp, now)} ago`;
}

/**
 * The wall-clock reading of the same instant, in the viewer's locale and zone.
 *
 * Beside the relative one and never instead of it: "6d ago" answers "is this
 * stale", the date answers "was that the Tuesday I was on this", and neither
 * substitutes for the other.
 *
 * The formatter is built once — constructing an `Intl.DateTimeFormat` is the
 * expensive half of formatting a date, and a hover card that draws two of
 * these would pay for it twice per open.
 */
let formatter: Intl.DateTimeFormat | null = null;

export function absoluteTime(timestamp: number): string {
  formatter ??= new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
  return formatter.format(new Date(timestamp));
}
