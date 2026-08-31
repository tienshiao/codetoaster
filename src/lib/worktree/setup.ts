import * as fs from "fs/promises";

// Running a project's setup_command around the agent
// (docs/v2-architecture.md §5.6).

/** The wrapper script, as one POSIX shell program.
 *
 * Everything variable arrives as a positional argument, so nothing is ever
 * interpolated into this text: the user's `setup_command` may contain quotes,
 * `$`, newlines, a here-document, and none of it can break out of a string it
 * is never inside. `$0` is the conventional throwaway name, `$1` the setup
 * command, `$2` the stamp path, and everything after them the agent's own
 * argv.
 *
 * `eval` is deliberate and is what `setup_command` *is*: a shell line the user
 * wrote — `bun install && bun run build` — not a program and its arguments.
 * Running it any other way would break the `&&` they typed. It runs in this
 * shell rather than a subshell, which is what `<setup> && exec "$@"` means in
 * §5.6 and is the useful half of it: a setup command can export environment —
 * a virtualenv activation, a version manager — and the agent inherits it. The
 * price is that an `exit` inside the setup line is a real exit and takes this
 * script with it before the stamp is written. That reads correctly everywhere
 * downstream: the code still reaches the tab, the agent still does not start,
 * and `readSetupOutcome` answering "nothing recorded" is true — setup did not
 * finish, it aborted.
 *
 * `exec "$@"` is the load-bearing end. It replaces the shell with the agent
 * rather than running it as a child, so the PTY is the agent's own — signals,
 * job control and the exit code all belong to it, and nothing is left holding
 * the terminal after setup. And because the agent's argv is passed through as
 * `"$@"` rather than reassembled into a command line, the prompt still travels
 * in argv exactly as `buildAgentCommand` put it there: no quoting, no
 * newlines to escape, no separate write into the PTY that could race the
 * agent's startup paint (§4.1).
 *
 * The stamp is written before the exit check and for both outcomes, because a
 * failed setup is a fact worth keeping — it is why the agent never started.
 * `mkdir -p` on its parent so this does not depend on the task directory
 * already existing; `${2%/*}` is parameter expansion rather than `dirname`, so
 * no subshell runs for it.
 *
 * And removed before setup runs, which is the half that makes
 * `readSetupOutcome` mean what it says. The stamp lives outside the checkout
 * (`paths.ts`), so a resume or a restore of this same task finds the previous
 * run's stamp already sitting there — and a caller asking "has setup finished,
 * and did it fail?" during a 90-second reinstall would be handed last time's
 * exit code as though it were this one's. Nothing recorded is the honest
 * answer while setup is still running. */
const WRAPPER = `setup=$1 stamp=$2
shift 2
mkdir -p "\${stamp%/*}" 2>/dev/null
rm -f "$stamp" 2>/dev/null
eval "$setup"
rc=$?
printf %s "$rc" > "$stamp" 2>/dev/null
if [ "$rc" -ne 0 ]; then
  echo "codetoaster: setup command failed (exit $rc)" >&2
  exit "$rc"
fi
exec "$@"`;

/** Wrap an agent command so the project's setup runs first, in the same
 * terminal.
 *
 * The alternative — awaiting setup before spawning anything — is what this
 * exists to avoid. A `bun install` on a cold worktree is tens of seconds, and
 * running it out of sight means the task shows a blank tab, or nothing at all,
 * for as long as it takes, with no way to see that it is a lockfile resolving
 * rather than a hang. Here its output is simply the first thing in the agent
 * tab, and the agent's first paint follows it.
 *
 * Returns `command` untouched when there is nothing to run, so a caller can
 * pass every spawn through this without asking. */
export function wrapWithSetup(
  command: string[],
  setupCommand: string | null | undefined,
  stampPath: string,
): string[] {
  const setup = setupCommand?.trim();
  if (!setup) return command;
  return ["sh", "-c", WRAPPER, "sh", setup, stampPath, ...command];
}

export interface SetupOutcome {
  /** What the setup command exited with. Zero means the agent went on to
   * start; anything else means the wrapper stopped there and the tab holds the
   * reason. */
  exitCode: number;
  /** How long the checkout took to become usable, which is what §5.6's
   * eviction grace is scaled by: a task whose restore re-runs a 90-second
   * install is worth keeping on disk far longer than one that restores in
   * 200ms.
   *
   * Measured from the spawn to the stamp's mtime, so it includes the shell's
   * own startup — a millisecond or two against a number whose only consumer
   * multiplies a seven-day grace period by it. Taken from the filesystem
   * rather than computed in the script because there is no portable way to
   * read a millisecond clock from POSIX sh: `date +%s%N` is a GNU extension
   * and prints a literal `N` on the BSD date that ships with macOS. */
  durationMs: number;
}

/** What the setup wrapper recorded, or undefined if it recorded nothing.
 *
 * Nothing is the answer whenever setup did not run to completion — no
 * `setup_command` configured, the task killed while it was installing, a
 * worktree evicted along with the stamp — and none of those are failures to
 * report. A caller wanting to know whether setup *failed* reads `exitCode`;
 * one wanting to know whether it ever finished checks for undefined. */
export async function readSetupOutcome(
  stampPath: string,
  spawnedAt: number,
): Promise<SetupOutcome | undefined> {
  let stat;
  try {
    stat = await fs.stat(stampPath);
  } catch {
    return undefined;
  }
  const raw = (await fs.readFile(stampPath, "utf8").catch(() => "")).trim();
  const exitCode = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (Number.isNaN(exitCode)) return undefined;
  return {
    exitCode,
    // Clamped at zero. A stamp older than the spawn is not a negative
    // duration, it is a stamp left by the previous run of this same task —
    // a resume, or a restore — that this spawn has not overwritten yet.
    durationMs: Math.max(0, Math.round(stat.mtimeMs - spawnedAt)),
  };
}
