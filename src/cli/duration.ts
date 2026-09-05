/** Durations as a user writes them on a command line, and back again.
 *
 * Deliberately a much smaller language than anything that parses "1h30m" or
 * "90 seconds": every duration this file exists for is a retention window
 * measured in minutes at the finest, and the round trip matters more than the
 * expressiveness. `spawnDaemon` re-spells whatever it was given onto the
 * foreground child's argv, so a value that parsed here has to survive being
 * printed and parsed again as exactly the same number of milliseconds.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const DURATION_RE = /^(\d+)([mhd])$/;

const UNITS: Record<string, number> = { m: MINUTE_MS, h: HOUR_MS, d: DAY_MS };

function rejection(text: string): Error {
  return new Error(
    `expected a duration like 30m, 2h or 7d, or 0 to disable; got ${JSON.stringify(text)}`,
  );
}

/** Milliseconds from `30m`, `2h`, `7d` — or from the bare `0` that turns a tier
 * off. Nothing else: no fractions, no seconds, no unit-less number, no
 * uppercase suffix. A duration typed wrong is far more likely to be a mistake
 * about the unit than a shorthand worth guessing at, and `--harvest-after 10`
 * meaning ten of something unstated is exactly the guess that would silently
 * suspend a user's tasks ten times too soon. */
export function parseDuration(text: string): number {
  const trimmed = text.trim();
  // The one duration with no unit, because zero minutes and zero days are the
  // same instruction: don't run this tier at all.
  if (trimmed === "0") return 0;
  const match = DURATION_RE.exec(trimmed);
  if (!match) throw rejection(text);
  const value = Number(match[1]);
  // `0m` and friends are rejected rather than folded into the disabling `0`:
  // one spelling for "off" is what keeps the help text and the round trip
  // honest.
  if (!(value > 0)) throw rejection(text);
  return value * UNITS[match[2]!]!;
}

/** The canonical spelling of a duration, such that `parseDuration` reads it
 * back as the same number of milliseconds. The largest unit that divides
 * exactly, so 7 days is `7d` rather than `10080m` — this text ends up on the
 * daemon's argv, where it is also the thing a user reads out of `ps`. */
export function formatDuration(ms: number): string {
  // Anything at or below zero is off, and `0` is the only spelling of off that
  // `parseDuration` accepts.
  if (ms <= 0) return "0";
  if (ms % DAY_MS === 0) return `${ms / DAY_MS}d`;
  if (ms % HOUR_MS === 0) return `${ms / HOUR_MS}h`;
  if (ms % MINUTE_MS === 0) return `${ms / MINUTE_MS}m`;
  // Unreachable from a parsed duration, which is always whole minutes. Reached
  // only if something sets a millisecond value programmatically, and rounding
  // *up* to a minute is the safe direction: rounding down could reach zero,
  // which does not mean "very short" but "disabled".
  return `${Math.max(1, Math.round(ms / MINUTE_MS))}m`;
}

/** One duration setting, from the flag if it was given and the environment
 * otherwise. `undefined` means neither was, and the default in the harvester
 * stands.
 *
 * The flag wins because argv is the more specific instruction: the environment
 * is where a launchd or systemd unit puts the machine's standing policy, and a
 * user starting a daemon by hand with a flag is overriding it on purpose.
 *
 * `flag` is `unknown` because `parseArgs` runs in `strict: false` mode, where a
 * declared string flag given no value parses as `true` rather than as text —
 * `--harvest-after` at the end of the line. That is a typo, not a request, and
 * it has to be caught here rather than reaching `parseDuration` as a non-string. */
export function resolveDuration(
  flag: unknown,
  env: string | undefined,
  names: { flag: string; env: string },
): number | undefined {
  if (flag !== undefined) {
    if (typeof flag !== "string") throw new Error(`${names.flag} needs a value`);
    return parse(flag, names.flag);
  }
  // An empty variable is how a shell spells "not set" when a unit file exports
  // it unconditionally, so it reads as absent rather than as a bad duration.
  if (env !== undefined && env.trim() !== "") return parse(env, names.env);
  return undefined;
}

/** The parse error, said again with the name of whatever carried the value —
 * without it the message names neither the flag nor the variable, and a user
 * with both set has nothing to go on. */
function parse(text: string, name: string): number {
  try {
    return parseDuration(text);
  } catch (e) {
    throw new Error(`${name}: ${(e as Error).message}`);
  }
}
