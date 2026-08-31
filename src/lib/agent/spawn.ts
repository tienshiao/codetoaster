import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { TaskRow } from "../db";

/** Where a task keeps the files that belong to it rather than to its
 * checkout: the injected settings.json (TASK-9) and the scrollback snapshot
 * (TASK-14) (docs/v2-architecture.md §4.2, §5.1). */
export function taskDir(taskId: string): string {
  return path.join(os.homedir(), ".codetoaster", "tasks", taskId);
}

/** Everything a task kept, gone: the settings, the scrollback and its staging
 * file, the setup stamp, a scratch index a snapshot died holding. What archive
 * and hard delete finish with (TASK-31), and the reason it lives beside
 * `taskDir` rather than in the caller — this is a recursive removal under the
 * user's home, so the guard belongs with the function that composes the path.
 *
 * The guard is that the path is a *direct child* of the tasks root. A task id
 * reaches here off a row and is a uuid we minted, so nothing should ever fail
 * it; that is exactly why it is cheap to insist. An id of `..`, or an empty
 * one, would otherwise resolve to the tasks root itself and take every task's
 * files with it.
 *
 * Best-effort, like `removeSnapshot`: a directory that is already not there is
 * the state being asked for, and a home that has gone read-only must not be
 * able to fail an archive that has already removed the checkout. */
export async function removeTaskDir(taskId: string): Promise<void> {
  const dir = path.resolve(taskDir(taskId));
  const root = path.resolve(taskDir(""));
  if (path.dirname(dir) !== root || dir === root) return;
  await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
}

export function taskSettingsPath(taskId: string): string {
  return path.join(taskDir(taskId), "settings.json");
}

/** The task's last screen, as the ANSI needed to repaint it. On disk rather
 * than on the row because it is a multi-hundred-KB blob per task, and SQLite
 * is where the small durable facts live (§5.1). */
export function taskScrollbackPath(taskId: string): string {
  return path.join(taskDir(taskId), "scrollback.ans");
}

/** What building the argv actually needs off the row. Narrower than TaskRow
 * so a caller can construct one — a resume (TASK-13) builds its command from
 * a row it has just rewritten, not from the one the store still holds. */
export type AgentTask = Pick<
  TaskRow,
  "agent_session_id" | "initial_prompt" | "model" | "permission_mode"
>;

/** How the conversation is opened.
 *
 *  `start`    — a new one, on an id we chose (§4.1).
 *  `resume`   — the stored one, by id (§4.3).
 *  `continue` — whatever the most recent conversation in this directory is,
 *               for when the stored id is unusable. With worktree-per-task
 *               that directory holds exactly one conversation, which is what
 *               makes the fallback unambiguous rather than a guess. */
export type AgentMode = "start" | "resume" | "continue";

export interface AgentCommandOptions {
  mode?: AgentMode;
  /** For `resume`: the conversation to open, when it is not the one on the
   * row — the transcript scan (§4.3, rung 3) finds an id the row has never
   * held. */
  sessionId?: string;
  /** The per-task settings.json that carries our hooks. Left out while there
   * is no file to point at: `--settings` on a missing path fails the start,
   * and TASK-9 is what writes one. */
  settingsPath?: string;
  /** The agent binary. Falls back to `$CODETOASTER_AGENT_BIN`, then `claude`
   * — the env var is how a test run stands something harmless in for a real
   * agent, and how a user whose `claude` is not on the daemon's PATH names
   * it. */
  bin?: string;
}

// Building the `claude` invocation for a task (docs/v2-architecture.md §4.1).
// Everything here is a pure function of the row: no filesystem, no spawn, no
// database — which is what lets the argv be asserted directly, and lets the
// resume path reuse the builder without inheriting a start path's side
// effects.
export function buildAgentCommand(task: AgentTask, options: AgentCommandOptions = {}): string[] {
  const mode = options.mode ?? "start";
  const sessionId = options.sessionId ?? task.agent_session_id;
  // `continue` names no conversation — that is the whole point of it. The
  // other two do, and reaching them without one means the caller skipped
  // allocating it: the task would be unresumable the moment it started, and
  // the symptom surfaces days later as a resume that finds nothing.
  if (mode !== "continue" && !sessionId) {
    throw new Error(`Cannot ${mode} an agent for a task with no agent_session_id`);
  }

  const bin = options.bin ?? (process.env.CODETOASTER_AGENT_BIN || "claude");
  const command = [bin];
  // We choose the conversation id up front so we know what to resume before
  // the process exists (§4.1). Resuming asks for that same id back, and a
  // resume keeps it (verified), so the row needs no update on the normal path.
  if (mode === "start") command.push("--session-id", sessionId!);
  else if (mode === "resume") command.push("--resume", sessionId!);
  else command.push("--continue");
  if (options.settingsPath) command.push("--settings", options.settingsPath);
  if (task.model) command.push("--model", task.model);
  if (task.permission_mode) command.push("--permission-mode", task.permission_mode);
  // Positional, and last: this starts an interactive session with the prompt
  // already submitted. It travels in argv rather than being written into the
  // PTY afterwards, so newlines and quotes need no escaping and there is no
  // race against the agent's startup paint. A task created with nothing to
  // say — the v1 "New Session" button, until the composer lands (TASK-24) —
  // gets no positional at all, which is a plain interactive start.
  //
  // Behind `--`, because the agent's argv parser is option-first: a prompt
  // that opens with a dash ("--- notes", "-v2 approach") is otherwise read as
  // a flag and the agent exits with `unknown option` before the task has drawn
  // a single character. Argv needs no quoting, but it does need the separator.
  //
  // Only on a fresh start. A resumed conversation already holds the prompt
  // that opened it; submitting it again would replay the task's first turn
  // every time it came back.
  if (mode === "start" && task.initial_prompt) command.push("--", task.initial_prompt);
  return command;
}

/** Env vars Claude Code sets in the processes it spawns, which a child of ours
 * must not inherit. Enumerated by name, from what a real Claude Code subprocess
 * environment was observed to carry.
 *
 * This used to be a blanket `CLAUDE_CODE_` prefix scrub, which was wrong in the
 * expensive direction: the same prefix carries documented *user* configuration
 * — `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_CLIENT_CERT` and its key and
 * passphrase, `CLAUDE_CODE_CERT_STORE`, `CLAUDE_CODE_EFFORT_LEVEL`, and the
 * rest — which a user exports from their shell profile. Stripping those meant
 * that a user who runs Bedrock, or a corporate mTLS setup, got every task's
 * agent booted without the configuration it needs and failing to authenticate,
 * while the identical `claude` run by hand from the same shell worked fine: a
 * symptom pointing nowhere near its cause. Inheriting a marker some future
 * version adds and we have not listed here degrades one task; stripping a
 * user's provider or certificate configuration breaks all of them. So the
 * default is now to inherit, and every removal is an exact name. */
const SCRUBBED_KEYS = [
  "CLAUDECODE",
  "CLAUDE_PID",
  "CLAUDE_EFFORT",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_BRIDGE_SESSION_ID",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
];
/** The one family still scrubbed by prefix. Everything under it is per-session
 * IPC plumbing pointing at the socket of the session that spawned us — never
 * something a user would set — so a name we have not seen yet is safer removed
 * than passed down to a child that would talk to the wrong session. */
const SCRUBBED_PREFIX = "CLAUDE_CODE_MESSAGING_";

export interface TaskEnvContext {
  taskId: string;
  /** The daemon's port, so `codetoaster hook` can reach us (TASK-10). Absent
   * outside a running server, where there is nothing to report to. */
  port?: number;
  /** Where the daemon actually answers, when that is not loopback. `--host`
   * binds one address exclusively, so a reporter that assembled
   * `http://localhost:<port>` for itself would have every POST refused and
   * every task would fall back to the output-activity guess the hooks exist to
   * replace. Omitted for a loopback bind, where the reporter's own default is
   * already right. */
  origin?: string;
}

// The environment overrides every PTY of a task runs under — the agent's, and
// the extra shells TASK-27 opens beside it. Returned as an overrides map, not
// a whole environment: `PtyOptions.env` is merged over `process.env`, and a
// key named `undefined` is how that merge removes an inherited one.
//
// The scrub is cheap insurance rather than a normal-path requirement (§4.1).
// A daemon started the usual way has none of these keys. One started from
// *inside* an agent session has all of them, and passes them straight down —
// at which point the child boots with transcript saving off, leaves no
// transcript on disk, and so has nothing to resume. The daemon is long-lived,
// so a single poisoned start quietly degrades every task spawned afterwards,
// with a symptom that surfaces nowhere near its cause.
export function taskEnv(
  source: Record<string, string | undefined>,
  context: TaskEnvContext,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  // The fixed keys unconditionally: naming one the source does not have costs
  // nothing, and it keeps the result the same shape whatever the daemon was
  // launched from. The prefixed family has to be enumerated, since only the
  // source knows which of them are set.
  for (const key of SCRUBBED_KEYS) env[key] = undefined;
  for (const key of Object.keys(source)) {
    if (key.startsWith(SCRUBBED_PREFIX)) env[key] = undefined;
  }

  env.CODETOASTER_TASK_ID = context.taskId;
  if (context.port !== undefined) env.CODETOASTER_PORT = String(context.port);
  if (context.origin !== undefined) env.CODETOASTER_ORIGIN = context.origin;
  return env;
}
