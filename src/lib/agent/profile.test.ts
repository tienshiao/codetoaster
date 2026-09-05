import { test, expect, describe } from "bun:test";
import {
  builtinProfiles,
  claudeProfile,
  profileCapabilities,
  renderTemplate,
  resolveBin,
  validateProfile,
  type AgentProfile,
} from "./profile";
import { buildAgentCommand, type AgentTask } from "./spawn";

const SESSION = "11111111-2222-3333-4444-555555555555";

function agentTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    agent_session_id: SESSION,
    initial_prompt: "",
    model: null,
    permission_mode: null,
    ...overrides,
  };
}

/** The built-ins under a fixed environment, so `shell`'s binary is this file's
 * choice rather than whoever's login shell ran the suite. */
function builtin(name: string, env: Record<string, string | undefined> = { SHELL: "/bin/zsh" }): AgentProfile {
  const profile = builtinProfiles(env).find((candidate) => candidate.name === name);
  if (!profile) throw new Error(`no built-in profile named ${name}`);
  return profile;
}

// `test/preload.ts` points `CODETOASTER_AGENT_BIN` at a stand-in before every
// test, which is exactly what it is for. The argv tests below are about the
// *shape* of the command rather than which binary answers, so they pass `bin`
// explicitly instead of clearing the variable — the binary override already has
// its own tests in `spawn.test.ts` and `agent-bin.test.ts`, and a file that
// deletes the variable is a file that can leak an unset one to the next.
const AS_CLAUDE = { bin: "claude" } as const;

describe("renderTemplate", () => {
  test("substitutes a value verbatim, whatever is in it", () => {
    const prompt = `Fix "the" thing\nand 'then' $(run) \`this\`\n\n  — please`;
    expect(renderTemplate(["--", "{prompt}"], { prompt })).toEqual(["--", prompt]);
  });

  test("substitutes a value that opens with a dash without touching it", () => {
    expect(renderTemplate(["--", "{prompt}"], { prompt: "--- notes" }))
      .toEqual(["--", "--- notes"]);
  });

  test("drops an unset placeholder together with the flag before it", () => {
    expect(renderTemplate(["--model", "{model}", "--force"], {}))
      .toEqual(["--force"]);
  });

  test("treats an empty string as unset", () => {
    expect(renderTemplate(["--", "{prompt}"], { prompt: "" })).toEqual([]);
    expect(renderTemplate(["--", "{prompt}"], { prompt: null })).toEqual([]);
  });

  test("keeps a literal before an unset placeholder when it is not a flag", () => {
    expect(renderTemplate(["run", "{model}"], {})).toEqual(["run"]);
  });

  // The reason the renderer tracks where the previous token came from: a prompt
  // that opens with a dash is content, and eating it would silently drop the
  // task's first turn.
  test("never removes a substituted value, even one that starts with a dash", () => {
    expect(renderTemplate(["{prompt}", "{model}"], { prompt: "--- notes" }))
      .toEqual(["--- notes"]);
  });

  test("unwinds a run of unset placeholders one flag at a time", () => {
    expect(renderTemplate(["--a", "{model}", "--b", "{settings}", "keep"], {}))
      .toEqual(["keep"]);
  });

  test("leaves literals that are not placeholders alone", () => {
    expect(renderTemplate(["--continue", "--"], {})).toEqual(["--continue", "--"]);
  });
});

describe("profileCapabilities", () => {
  test("claude does everything", () => {
    expect(profileCapabilities(builtin("claude"))).toEqual({
      sessionId: true,
      resume: true,
      continue: true,
      hooks: true,
      model: true,
      permissionMode: true,
      prompt: true,
    });
  });

  test("shell does nothing at all", () => {
    expect(profileCapabilities(builtin("shell"))).toEqual({
      sessionId: false,
      resume: false,
      continue: false,
      hooks: false,
      model: false,
      permissionMode: false,
      prompt: false,
    });
  });

  test("pi resumes and takes a model, but has no hooks and no permission mode", () => {
    expect(profileCapabilities(builtin("pi"))).toEqual({
      sessionId: true,
      resume: true,
      continue: true,
      hooks: false,
      model: true,
      permissionMode: false,
      prompt: true,
    });
  });

  // The point of deriving them: the answer comes from the templates, so it
  // cannot disagree with what would actually be spawned.
  test("hooks follow {settings} out of the templates", () => {
    expect(profileCapabilities(builtin("claude")).hooks).toBe(true);
    expect(profileCapabilities(builtin("pi")).hooks).toBe(false);
    expect(profileCapabilities(builtin("shell")).hooks).toBe(false);
  });

  test("permission mode is claude's alone", () => {
    const withPermissionMode = builtinProfiles({})
      .filter((profile) => profileCapabilities(profile).permissionMode)
      .map((profile) => profile.name);
    expect(withPermissionMode).toEqual(["claude"]);
  });
});

describe("validateProfile", () => {
  const base: AgentProfile = { name: "p", label: "P", bin: "p", start: [] };

  test("accepts every built-in", () => {
    for (const profile of builtinProfiles({ SHELL: "/bin/zsh" })) {
      expect(() => validateProfile(profile)).not.toThrow();
    }
  });

  test("accepts an empty start template", () => {
    // The shell profile's shape: a binary and nothing after it.
    expect(() => validateProfile(base)).not.toThrow();
  });

  test("rejects a profile with no name", () => {
    expect(() => validateProfile({ ...base, name: "" })).toThrow(/needs a name/);
  });

  test("rejects a profile with no bin, naming it", () => {
    expect(() => validateProfile({ ...base, name: "pi", bin: "" }))
      .toThrow(/profile "pi": needs a bin/);
  });

  test("rejects a profile with no start template, naming it", () => {
    expect(() => validateProfile({ ...base, name: "pi", start: undefined as unknown as string[] }))
      .toThrow(/profile "pi": needs a start template/);
  });

  test("rejects an unknown placeholder, naming it", () => {
    expect(() => validateProfile({ ...base, name: "pi", start: ["--x", "{nope}"] }))
      .toThrow(/profile "pi": start template names an unknown placeholder \{nope\}/);
  });

  // A token assembled around a placeholder is a token that can no longer carry
  // a prompt containing a space, so the language does not have one.
  test("rejects a placeholder embedded in a larger token, naming it", () => {
    expect(() => validateProfile({ ...base, name: "pi", start: ["--model={model}"] }))
      .toThrow(/profile "pi": start template embeds a placeholder/);
  });

  test("rejects a resume template that would replay the prompt, naming it", () => {
    expect(() => validateProfile({ ...base, name: "pi", resume: ["--", "{prompt}"] }))
      .toThrow(/profile "pi": resume template must not name \{prompt\}/);
    expect(() => validateProfile({ ...base, name: "pi", continue: ["--", "{prompt}"] }))
      .toThrow(/profile "pi": continue template must not name \{prompt\}/);
  });

  test("rejects a resume that asks for an id nothing minted, naming it", () => {
    expect(() =>
      validateProfile({
        ...base,
        name: "pi",
        start: ["--new"],
        resume: ["--session-id", "{session_id}"],
      }),
    ).toThrow(/profile "pi": resume names \{session_id\} but start never sets one/);
  });
});

describe("resolveBin", () => {
  const profile = builtin("claude");

  test("prefers the environment variable the profile names", () => {
    expect(resolveBin(profile, { CODETOASTER_AGENT_BIN: "/opt/agent" })).toBe("/opt/agent");
  });

  test("falls back to the profile's own bin when it is unset or empty", () => {
    expect(resolveBin(profile, {})).toBe("claude");
    expect(resolveBin(profile, { CODETOASTER_AGENT_BIN: "" })).toBe("claude");
  });

  test("ignores the environment for a profile that names none", () => {
    expect(resolveBin(builtin("pi"), { CODETOASTER_AGENT_BIN: "/opt/agent" })).toBe("pi");
  });
});

describe("builtinProfiles", () => {
  test("the shell profile runs the user's shell", () => {
    expect(builtin("shell", { SHELL: "/usr/bin/fish" }).bin).toBe("/usr/bin/fish");
  });

  test("and falls back to /bin/sh when there is none", () => {
    expect(builtin("shell", {}).bin).toBe("/bin/sh");
    expect(builtin("shell", { SHELL: "" }).bin).toBe("/bin/sh");
  });

  test("claudeProfile is the built-in of that name", () => {
    expect(claudeProfile().name).toBe("claude");
    expect(claudeProfile().start).toEqual(builtin("claude").start);
  });
});

describe("the claude profile's argv", () => {
  const claude = builtin("claude");
  const full = agentTask({ initial_prompt: "go", model: "opus", permission_mode: "acceptEdits" });
  const options = { profile: claude, settingsPath: "/tmp/settings.json", ...AS_CLAUDE };

  test("start carries everything the row has", () => {
    expect(buildAgentCommand(full, options)).toEqual([
      "claude",
      "--session-id", SESSION,
      "--settings", "/tmp/settings.json",
      "--model", "opus",
      "--permission-mode", "acceptEdits",
      "--", "go",
    ]);
  });

  test("resume asks for the same id back and leaves the prompt behind", () => {
    expect(buildAgentCommand(full, { ...options, mode: "resume" })).toEqual([
      "claude",
      "--resume", SESSION,
      "--settings", "/tmp/settings.json",
      "--model", "opus",
      "--permission-mode", "acceptEdits",
    ]);
  });

  test("continue names no conversation", () => {
    expect(buildAgentCommand(full, { ...options, mode: "continue" })).toEqual([
      "claude",
      "--continue",
      "--settings", "/tmp/settings.json",
      "--model", "opus",
      "--permission-mode", "acceptEdits",
    ]);
  });

  test("a bare row leaves nothing dangling", () => {
    expect(buildAgentCommand(agentTask(), { profile: claude, ...AS_CLAUDE }))
      .toEqual(["claude", "--session-id", SESSION]);
    expect(buildAgentCommand(agentTask(), { profile: claude, mode: "continue", ...AS_CLAUDE }))
      .toEqual(["claude", "--continue"]);
  });

  test("is what a caller that names no profile gets", () => {
    expect(buildAgentCommand(full, { settingsPath: "/tmp/settings.json", ...AS_CLAUDE }))
      .toEqual(buildAgentCommand(full, options));
  });
});

describe("the pi profile's argv", () => {
  const pi = builtin("pi");
  const full = agentTask({ initial_prompt: "go", model: "opus", permission_mode: "acceptEdits" });

  // The same flag opens and reopens a pi session, and the permission mode and
  // the settings file the row carries are simply not passed: pi has neither.
  test("start names the id we chose and puts the prompt behind --", () => {
    expect(buildAgentCommand(full, { profile: pi, settingsPath: "/tmp/settings.json" }))
      .toEqual(["pi", "--session-id", SESSION, "--model", "opus", "--", "go"]);
  });

  test("resume uses the same flag and drops the prompt", () => {
    expect(buildAgentCommand(full, { profile: pi, mode: "resume" }))
      .toEqual(["pi", "--session-id", SESSION, "--model", "opus"]);
  });

  test("a row with no model resumes on the id alone", () => {
    expect(buildAgentCommand(agentTask(), { profile: pi, mode: "resume" }))
      .toEqual(["pi", "--session-id", SESSION]);
  });

  test("continue is the directory-scoped rung", () => {
    expect(buildAgentCommand(full, { profile: pi, mode: "continue" }))
      .toEqual(["pi", "--continue", "--model", "opus"]);
  });

  test("still refuses to start without an id to resume later", () => {
    expect(() => buildAgentCommand(agentTask({ agent_session_id: null }), { profile: pi }))
      .toThrow(/agent_session_id/);
  });
});

describe("the shell profile's argv", () => {
  const shell = builtin("shell", { SHELL: "/bin/zsh" });

  test("is the shell and nothing else, whatever the row carries", () => {
    const full = agentTask({
      initial_prompt: "go",
      model: "opus",
      permission_mode: "acceptEdits",
    });
    expect(buildAgentCommand(full, { profile: shell, settingsPath: "/tmp/settings.json" }))
      .toEqual(["/bin/zsh"]);
  });

  test("starts even for a task that has no session id", () => {
    expect(buildAgentCommand(agentTask({ agent_session_id: null }), { profile: shell }))
      .toEqual(["/bin/zsh"]);
  });

  test("cannot resume or continue, and says which profile could not", () => {
    expect(() => buildAgentCommand(agentTask(), { profile: shell, mode: "resume" }))
      .toThrow(/profile "shell" cannot resume/);
    expect(() => buildAgentCommand(agentTask(), { profile: shell, mode: "continue" }))
      .toThrow(/profile "shell" cannot continue/);
  });
});

// What a profile that can do neither of the two above gets on reopen
// (TASK-89.4): the start command again, in the task's own directory.
describe("restarting", () => {
  const full = agentTask({ initial_prompt: "go", model: "opus", permission_mode: "acceptEdits" });

  test("the shell profile restarts as the bare shell", () => {
    expect(buildAgentCommand(full, { profile: builtin("shell"), mode: "restart" }))
      .toEqual(["/bin/zsh"]);
  });

  // The id is kept rather than minted, and for pi that makes the restart a
  // resume by other means: `--session-id` opens the exact session, creating it
  // only if it is missing. A profile that merely labels its session with the id
  // loses nothing by being handed the same one.
  test("keeps the row's session id where the template names one", () => {
    expect(buildAgentCommand(full, { profile: builtin("pi"), mode: "restart" }))
      .toEqual(["pi", "--session-id", SESSION, "--model", "opus"]);
  });

  // The whole difference from a start. The conversation that answered this
  // prompt is not coming back, and submitting it again on every reopen would
  // replay the task's first turn — the exact bug the resume rule prevents, one
  // door along.
  test("never replays the prompt, so no separator is left behind either", () => {
    const argv = buildAgentCommand(full, { profile: builtin("pi"), mode: "restart" });
    expect(argv).not.toContain("go");
    expect(argv).not.toContain("--");
  });

  // A restart renders `start`, so a profile that *can* resume can still be
  // asked for one — it simply is not what the ladder offers such a profile.
  test("renders the start template, hooks and all, for a profile that has one", () => {
    expect(buildAgentCommand(full, {
      profile: claudeProfile(),
      mode: "restart",
      settingsPath: "/tmp/settings.json",
      bin: "claude",
    })).toEqual([
      "claude",
      "--session-id", SESSION,
      "--settings", "/tmp/settings.json",
      "--model", "opus",
      "--permission-mode", "acceptEdits",
    ]);
  });
});
