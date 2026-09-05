/**
 * What it takes to run a task on something other than `claude`
 * (docs/v2-architecture.md §4.1, TASK-89).
 *
 * A *profile* is a binary plus argv templates: one for starting a conversation,
 * and optionally one for resuming a named one and one for continuing whatever
 * conversation the directory last held. A template is an array of tokens that
 * follow the binary, and a token that is exactly `{session_id}`, `{prompt}`,
 * `{model}`, `{permission_mode}`, `{settings}` or `{cwd}` is replaced with the
 * value off the task row. Everything else is a literal. That is the whole
 * language: no shell, no quoting, no interpolation inside a token — because the
 * argv is handed to `Bun.spawn` as an array, and the moment a template could
 * build a token out of pieces, a prompt containing a space or a quote would
 * stop being one argument.
 *
 * **An unset value drops its flag too.** When a placeholder has no value the
 * token disappears, and so does the token emitted immediately before it if that
 * token is a literal starting with a dash. So `--model {model}` on a row with
 * no model contributes nothing rather than a dangling `--model`, and `--
 * {prompt}` on a task with no prompt leaves no orphaned separator. The
 * "literal" half of that rule matters: if the previous token was itself a
 * substituted value it is never removed, so a prompt that opens with a dash
 * survives an unset placeholder after it.
 *
 * **Capabilities are derived, not declared.** `profileCapabilities` reads the
 * templates and reports what the profile can do — whether it takes a session id
 * we chose up front, whether it can resume, whether it accepts our hook
 * settings file, a model, a permission mode. Deriving them is the point: a
 * declared flag and a template are two places to say the same thing, and they
 * drift. A profile that stops passing `--settings` stops claiming hooks in the
 * same edit, and TASK-12's degraded state follows from the templates rather
 * than from someone remembering to change a boolean.
 *
 * Pure, like `buildAgentCommand` itself: no filesystem, no spawn, no database.
 * `builtinProfiles` takes an environment rather than reading `process.env` so a
 * test can hand it one.
 */

/** The profile a task gets when nothing — not the request, not the project —
 * names one: today's behaviour.
 *
 * Here rather than in `profiles.ts`, which is where the registry lives and
 * where this used to be, for the reason `naming.ts` is import-free: this file
 * touches no filesystem, so the frontend can share the constant, and the
 * composer works out which controls to disable against the same name the
 * server resolves against. `profiles.ts` re-exports it, so every existing
 * importer is unchanged. */
export const DEFAULT_PROFILE = "claude";

export const PLACEHOLDERS = [
  "session_id",
  "prompt",
  "model",
  "permission_mode",
  "settings",
  "cwd",
] as const;

export type Placeholder = (typeof PLACEHOLDERS)[number];

export interface AgentProfile {
  name: string;
  /** Shown in the composer. */
  label: string;
  /** The binary. */
  bin: string;
  /** An environment variable whose value, when set and non-empty, replaces
   * `bin`. How `CODETOASTER_AGENT_BIN` keeps standing a harmless script in for
   * the real agent under test, and how a user whose `claude` is off the
   * daemon's PATH names it. */
  binEnv?: string;
  /** Argv templates after the binary. Tokens that are exactly `{placeholder}`
   * are substituted. An empty `start` is legitimate — the shell profile runs a
   * shell with no arguments at all. */
  start: string[];
  /** Absent when the profile cannot bring a named conversation back. */
  resume?: string[];
  /** Absent when the profile has no directory-scoped fallback rung. */
  continue?: string[];
}

export interface ProfileCapabilities {
  /** `start` mentions `{session_id}`, so we choose the id before the process
   * exists and know what to resume. */
  sessionId: boolean;
  resume: boolean;
  continue: boolean;
  /** Any template mentions `{settings}`, so our hooks reach the agent and the
   * task reports real state rather than the output-activity guess. */
  hooks: boolean;
  model: boolean;
  permissionMode: boolean;
  /** `start` mentions `{prompt}`, so a task can be opened with something to
   * say. */
  prompt: boolean;
}

export type TemplateValues = Partial<Record<Placeholder, string | null | undefined>>;

const PLACEHOLDER_SET = new Set<string>(PLACEHOLDERS);

/** The name of the placeholder a token *is*, or null for a literal. Exactly
 * `{name}` and nothing else: a token that embeds a placeholder among other text
 * is rejected by `validateProfile`, so the renderer never has to decide what
 * `--model={model}` means. */
export function isPlaceholder(token: string): Placeholder | null {
  if (token.length < 3 || token[0] !== "{" || token[token.length - 1] !== "}") return null;
  const name = token.slice(1, -1);
  return PLACEHOLDER_SET.has(name) ? (name as Placeholder) : null;
}

/** Substitute a template against a set of values.
 *
 * Values are emitted verbatim — no escaping, no trimming, no quoting. A prompt
 * with newlines, quotes and a leading dash reaches the agent as typed, which is
 * the entire reason the prompt travels in argv instead of being written into
 * the PTY afterwards.
 *
 * An unset value (missing, null, or the empty string — an empty prompt is a
 * task with nothing to say, not a task whose first turn is blank) removes its
 * token and the dash-prefixed literal before it. */
export function renderTemplate(template: string[], values: TemplateValues): string[] {
  const out: string[] = [];
  // Whether the token last pushed came from the template rather than from a
  // value. Only a literal may be dropped as an orphaned flag: a substituted
  // value that happens to start with a dash — `--- notes` as a prompt — is
  // content, and taking it back would silently eat the task's first turn.
  let lastWasLiteral = false;

  for (const token of template) {
    const placeholder = isPlaceholder(token);
    if (placeholder === null) {
      out.push(token);
      lastWasLiteral = true;
      continue;
    }
    const value = values[placeholder];
    if (typeof value === "string" && value !== "") {
      out.push(value);
      lastWasLiteral = false;
      continue;
    }
    if (lastWasLiteral && out.length > 0 && out[out.length - 1]!.startsWith("-")) {
      out.pop();
      // Whatever now sits at the end was pushed before the flag, and we no
      // longer know which kind it was. Treating it as a value is the safe
      // reading: it stops a run of unset placeholders from unwinding tokens
      // that were never a pair.
      lastWasLiteral = false;
    }
  }
  return out;
}

function mentions(template: string[] | undefined, placeholder: Placeholder): boolean {
  return template !== undefined && template.some((token) => isPlaceholder(token) === placeholder);
}

export function profileCapabilities(profile: AgentProfile): ProfileCapabilities {
  const all = [profile.start, profile.resume, profile.continue];
  const anyMentions = (placeholder: Placeholder) =>
    all.some((template) => mentions(template, placeholder));
  return {
    sessionId: mentions(profile.start, "session_id"),
    resume: profile.resume !== undefined,
    continue: profile.continue !== undefined,
    hooks: anyMentions("settings"),
    model: anyMentions("model"),
    permissionMode: anyMentions("permission_mode"),
    prompt: mentions(profile.start, "prompt"),
  };
}

/** Everything a profile has to satisfy before anything is spawned from it —
 * the built-ins in a test, and a user-defined one when TASK-89.2 reads the
 * daemon's configuration. Throws rather than returning a result: a malformed
 * profile has no usable fallback, and the message has to name which one. */
export function validateProfile(profile: AgentProfile): void {
  const name = typeof profile?.name === "string" ? profile.name : "";
  const fail = (problem: string): never => {
    throw new Error(`profile ${JSON.stringify(name)}: ${problem}`);
  };

  if (typeof profile?.name !== "string" || profile.name === "") {
    fail("needs a name");
  }
  if (typeof profile.bin !== "string" || profile.bin === "") {
    fail("needs a bin");
  }
  if (!Array.isArray(profile.start)) {
    fail("needs a start template");
  }

  const templates: [string, string[] | undefined][] = [
    ["start", profile.start],
    ["resume", profile.resume],
    ["continue", profile.continue],
  ];
  for (const [mode, template] of templates) {
    if (template === undefined) continue;
    for (const token of template) {
      if (typeof token !== "string") fail(`${mode} template has a non-string token`);
      if (/^\{.*\}$/.test(token) && isPlaceholder(token) === null) {
        fail(`${mode} template names an unknown placeholder ${token}`);
      }
      if (isPlaceholder(token) === null && /\{[^{}]*\}/.test(token)) {
        // `--model={model}` would have to be assembled from a value, and a
        // token built by concatenation is a token that can no longer carry a
        // prompt containing a space. The placeholder gets its own token.
        fail(`${mode} template embeds a placeholder in ${JSON.stringify(token)}; it must be its own token`);
      }
    }
  }

  // A resumed conversation already holds the prompt that opened it. Replaying
  // it would submit the task's first turn again every time it came back.
  for (const mode of ["resume", "continue"] as const) {
    if (mentions(profile[mode], "prompt")) {
      fail(`${mode} template must not name {prompt}: the conversation already has it`);
    }
  }

  // Nothing would have minted the id the resume asks for.
  if (mentions(profile.resume, "session_id") && !mentions(profile.start, "session_id")) {
    fail("resume names {session_id} but start never sets one");
  }
}

/** The binary to run: the environment variable named by `binEnv`, when it is
 * set and non-empty, else the profile's own `bin`. */
export function resolveBin(
  profile: AgentProfile,
  env: Record<string, string | undefined> = process.env,
): string {
  if (profile.binEnv) {
    const override = env[profile.binEnv];
    if (override) return override;
  }
  return profile.bin;
}

/** Today's `claude` invocation, as data.
 *
 * The order reproduces the argv `buildAgentCommand` used to build by hand, and
 * `spawn.test.ts` is what holds it there. The reasoning that used to live in
 * that function now lives here, where the template does:
 *
 *  - The session id goes on `start` because we choose the conversation id up
 *    front, before the process exists, so we know what to resume (§4.1). A
 *    resume asks for that same id back and keeps it, so the row needs no update
 *    on the normal path.
 *  - `continue` names no conversation — that is the whole point of it. With
 *    worktree-per-task the directory holds exactly one, which is what makes the
 *    fallback unambiguous rather than a guess.
 *  - The prompt is positional and last, behind `--`, because the agent's argv
 *    parser is option-first: a prompt that opens with a dash ("--- notes") is
 *    otherwise read as a flag and the agent exits with `unknown option` before
 *    the task has drawn a character. Argv needs no quoting, but it does need
 *    the separator.
 *  - The prompt appears only on `start`, for the reason `validateProfile`
 *    enforces for every profile: resuming would replay the first turn.
 *  - `--settings` carries our hooks (TASK-9), and drops out with its flag while
 *    there is no file to point at — `--settings` on a missing path fails the
 *    start outright. */
const CLAUDE_PROFILE: AgentProfile = {
  name: "claude",
  label: "Claude Code",
  bin: "claude",
  binEnv: "CODETOASTER_AGENT_BIN",
  start: [
    "--session-id", "{session_id}",
    "--settings", "{settings}",
    "--model", "{model}",
    "--permission-mode", "{permission_mode}",
    "--", "{prompt}",
  ],
  resume: [
    "--resume", "{session_id}",
    "--settings", "{settings}",
    "--model", "{model}",
    "--permission-mode", "{permission_mode}",
  ],
  continue: [
    "--continue",
    "--settings", "{settings}",
    "--model", "{model}",
    "--permission-mode", "{permission_mode}",
  ],
};

/** pi, the worked example of an alternate agent (checked against `pi --help`,
 * 2026-09). `pi --session-id <id>` opens an exact session, creating it if it is
 * missing, so the same flag serves start and resume and we keep choosing the id
 * up front exactly as we do for claude. The model is `--model <provider/id>`,
 * `--continue` is the same directory-scoped fallback, and there is no
 * permission-mode flag and no hooks — so a pi task lives in TASK-12's degraded
 * mode until its extensions grow a state reporter. */
const PI_PROFILE: AgentProfile = {
  name: "pi",
  label: "pi",
  bin: "pi",
  start: ["--session-id", "{session_id}", "--model", "{model}", "--", "{prompt}"],
  resume: ["--session-id", "{session_id}", "--model", "{model}"],
  continue: ["--continue", "--model", "{model}"],
};

/** The profiles that ship with the daemon. Takes an environment because the
 * shell profile's binary is the user's `$SHELL`, and a test needs to hand it
 * one rather than inherit whoever ran the suite. */
export function builtinProfiles(
  env: Record<string, string | undefined> = process.env,
): AgentProfile[] {
  return [
    CLAUDE_PROFILE,
    {
      name: "shell",
      label: "Shell (no agent)",
      // No agent at all: a plain shell in the task's worktree, which is how the
      // UI gets exercised without spawning a real Claude Code session and
      // spending tokens (TASK-89 §5). Nothing is passed to it — not the prompt,
      // not the model — so there is no start template and no resume: reopening
      // a suspended shell task starts a new shell.
      bin: env.SHELL || "/bin/sh",
      start: [],
    },
    PI_PROFILE,
  ];
}

/** The default profile, and the one whose argv the existing spawn tests pin. */
export function claudeProfile(): AgentProfile {
  return CLAUDE_PROFILE;
}
