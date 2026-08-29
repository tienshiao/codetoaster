import { taskSettingsPath } from "./spawn";

// The events the task record is kept in sync by (docs/v2-architecture.md
// §4.2). All six point at one command, because the payload names itself in
// `hook_event_name` — so there is nothing per-event for the command line to
// carry, and one reporter to keep correct instead of six.
export const HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "Stop",
  "Notification",
  "SessionEnd",
  "PreCompact",
] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

// Hooks run synchronously in the agent's path, so this is a ceiling on how
// long a wedged daemon can stall a keystroke. The reporter has its own, much
// shorter fetch timeout (TASK-10); this is the outer guard for the case where
// it never gets that far.
const HOOK_TIMEOUT_SECONDS = 5;

interface HookHandler {
  type: "command";
  command: string;
  timeout: number;
}

/** A matcher group. Ours carry no `matcher`, which is how an event says
 * "every occurrence": we want `SessionStart` from a resume and a `/clear`
 * exactly as much as from a startup, and a `Notification` whatever prompted
 * it. */
interface MatcherGroup {
  hooks: HookHandler[];
}

export interface TaskSettings {
  hooks: Record<HookEvent, MatcherGroup[]>;
}

// `--settings` merges with the user's own configuration rather than shadowing
// it (verified, §4.4), so this file adds our hooks to whatever the user
// already runs instead of replacing them.
export function buildSettings(command: string): TaskSettings {
  const hooks = {} as Record<HookEvent, MatcherGroup[]>;
  for (const event of HOOK_EVENTS) {
    hooks[event] = [{ hooks: [{ type: "command", command, timeout: HOOK_TIMEOUT_SECONDS }] }];
  }
  return { hooks };
}

/** Single-quote a path for the shell that runs the hook command. Task
 * directories are ours, but the daemon's own path is wherever the user put
 * it — "/Users/me/My Tools/codetoaster" has to survive. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

// True when `mainPath` addresses the embedded filesystem of a
// `bun build --compile` binary (`/$bunfs/root/<name>`) rather than a script on
// disk. Decided by that marker and not by whether the path exists: inside the
// binary it *does* exist, because the embedded filesystem is mounted for the
// process — an existence check reads backwards.
export function isCompiledBinary(mainPath: string): boolean {
  return mainPath.includes("/$bunfs/") || /[\\/]~BUN[\\/]/.test(mainPath);
}

/** The command line, given where the daemon is running from. Split out from
 * `hookCommand` so both arms are testable from either kind of process. */
export function hookCommandFrom(execPath: string, mainPath: string): string {
  // A compiled binary runs itself. A script needs the runtime in front of it —
  // `bun /path/to/src/index.ts hook`.
  const parts = isCompiledBinary(mainPath) ? [execPath] : [execPath, mainPath];
  return [...parts.map(shellQuote), "hook"].join(" ");
}

/** What a hook actually runs. Derived from the running daemon rather than
 * hardcoded as `codetoaster hook`: in development there is no `codetoaster` on
 * PATH at all, and even installed, the binary the user launched is the one
 * that owns their tasks. */
export function hookCommand(): string {
  return hookCommandFrom(process.execPath, Bun.main);
}

/** Writes the task's settings and answers the path to pass to `--settings`.
 * Rewritten on every start rather than once per task: the daemon that resumes
 * a task months later may live somewhere else entirely, and a stale command
 * line would leave the task running with hooks that silently never fire. */
export async function writeTaskSettings(
  taskId: string,
  command: string = hookCommand(),
): Promise<string> {
  const settingsPath = taskSettingsPath(taskId);
  // Bun.write creates the parent directories, which is the whole of "created
  // on demand" — the task directory exists because its settings do.
  await Bun.write(settingsPath, JSON.stringify(buildSettings(command), null, 2));
  return settingsPath;
}
