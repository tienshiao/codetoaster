import * as os from "os";
import * as path from "path";
import type { TaskRow } from "../db";

/** Where a task keeps the files that belong to it rather than to its
 * checkout: the injected settings.json (TASK-9), and the scrollback snapshot
 * TASK-14 adds (docs/v2-architecture.md §4.2, §5.1). */
export function taskDir(taskId: string): string {
  return path.join(os.homedir(), ".codetoaster", "tasks", taskId);
}

export function taskSettingsPath(taskId: string): string {
  return path.join(taskDir(taskId), "settings.json");
}

/** What building the argv actually needs off the row. Narrower than TaskRow
 * so a caller can construct one — a resume (TASK-13) builds its command from
 * a row it has just rewritten, not from the one the store still holds. */
export type AgentTask = Pick<
  TaskRow,
  "agent_session_id" | "initial_prompt" | "model" | "permission_mode"
>;

export interface AgentCommandOptions {
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
  // We choose the conversation id up front so we know what to resume before
  // the process exists (§4.1). Reaching here without one means the caller
  // skipped that, and the task would be unresumable the moment it started —
  // worth failing the spawn over, since the symptom otherwise surfaces days
  // later as a resume that cannot find anything.
  if (!task.agent_session_id) {
    throw new Error("Cannot start an agent for a task with no agent_session_id");
  }

  const bin = options.bin ?? (process.env.CODETOASTER_AGENT_BIN || "claude");
  const command = [bin, "--session-id", task.agent_session_id];
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
  if (task.initial_prompt) command.push("--", task.initial_prompt);
  return command;
}

/** Env vars Claude Code sets for its own children, which a child of ours must
 * not inherit. `CLAUDE_CODE_` covers the family (`CLAUDE_CODE_CHILD_SESSION`,
 * `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_MESSAGING_*`, …). */
const SCRUBBED_KEYS = ["CLAUDECODE", "CLAUDE_PID", "CLAUDE_EFFORT"];
const SCRUBBED_PREFIX = "CLAUDE_CODE_";

export interface TaskEnvContext {
  taskId: string;
  /** The daemon's port, so `codetoaster hook` can reach us (TASK-10). Absent
   * outside a running server, where there is nothing to report to. */
  port?: number;
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
  return env;
}
