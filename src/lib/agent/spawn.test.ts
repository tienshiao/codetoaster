import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import * as os from "os";
import * as path from "path";
import { buildAgentCommand, taskEnv, taskDir, taskSettingsPath, type AgentTask } from "./spawn";

function agentTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    agent_session_id: "11111111-2222-3333-4444-555555555555",
    initial_prompt: "",
    model: null,
    permission_mode: null,
    ...overrides,
  };
}

describe("buildAgentCommand", () => {
  // Another test file points this at a harmless stand-in for the whole run, so
  // the tests that assert the default have to start from it being unset.
  let previousBin: string | undefined;
  beforeAll(() => {
    previousBin = process.env.CODETOASTER_AGENT_BIN;
    delete process.env.CODETOASTER_AGENT_BIN;
  });
  afterAll(() => {
    if (previousBin !== undefined) process.env.CODETOASTER_AGENT_BIN = previousBin;
  });

  test("passes the session id we allocated", () => {
    expect(buildAgentCommand(agentTask())).toEqual([
      "claude",
      "--session-id",
      "11111111-2222-3333-4444-555555555555",
    ]);
  });

  test("refuses to start a task that has no session id to resume later", () => {
    expect(() => buildAgentCommand(agentTask({ agent_session_id: null })))
      .toThrow(/agent_session_id/);
  });

  test("includes the optional flags only when the row carries them", () => {
    const command = buildAgentCommand(
      agentTask({ model: "opus", permission_mode: "acceptEdits" }),
      { settingsPath: "/tmp/settings.json" },
    );
    expect(command).toEqual([
      "claude",
      "--session-id", "11111111-2222-3333-4444-555555555555",
      "--settings", "/tmp/settings.json",
      "--model", "opus",
      "--permission-mode", "acceptEdits",
    ]);
  });

  test("omits --settings while there is no file to point at", () => {
    expect(buildAgentCommand(agentTask())).not.toContain("--settings");
  });

  // The whole reason the prompt travels in argv (§4.1): an array element needs
  // no escaping, so whatever the composer collected reaches the agent as typed.
  test("carries a prompt with newlines and quotes through verbatim", () => {
    const prompt = `Fix "the" thing\nand 'then' $(run) \`this\`\n\n  — please`;
    const command = buildAgentCommand(agentTask({ initial_prompt: prompt }));
    expect(command.at(-1)).toBe(prompt);
  });

  // The agent parses options first, so a prompt that opens with a dash reads
  // as a flag and the start fails outright ("unknown option '-x …'").
  test("keeps a prompt that opens with a dash out of option parsing", () => {
    const command = buildAgentCommand(agentTask({ initial_prompt: "--- notes" }));
    expect(command.slice(-2)).toEqual(["--", "--- notes"]);
  });

  test("puts the prompt last, after every flag", () => {
    const command = buildAgentCommand(
      agentTask({ initial_prompt: "go", model: "opus" }),
      { settingsPath: "/tmp/s.json" },
    );
    expect(command.at(-1)).toBe("go");
    expect(command.indexOf("go")).toBe(command.length - 1);
  });

  // A v1 "New Session" has nothing to say yet; a bare interactive start is the
  // right answer, not an empty positional the agent would submit as a turn.
  test("passes no positional when the task has no prompt", () => {
    expect(buildAgentCommand(agentTask({ initial_prompt: "" }))).toHaveLength(3);
  });

  test("runs an overridable binary", () => {
    expect(buildAgentCommand(agentTask(), { bin: "/usr/local/bin/claude" })[0])
      .toBe("/usr/local/bin/claude");
  });

  test("falls back to $CODETOASTER_AGENT_BIN before claude", () => {
    const previous = process.env.CODETOASTER_AGENT_BIN;
    process.env.CODETOASTER_AGENT_BIN = "/opt/agent";
    try {
      expect(buildAgentCommand(agentTask())[0]).toBe("/opt/agent");
      // An explicit option still outranks it.
      expect(buildAgentCommand(agentTask(), { bin: "claude" })[0]).toBe("claude");
    } finally {
      if (previous === undefined) delete process.env.CODETOASTER_AGENT_BIN;
      else process.env.CODETOASTER_AGENT_BIN = previous;
    }
  });
});

describe("taskEnv", () => {
  // The full set observed in a real Claude Code subprocess environment, so the
  // removal list is asserted against what it was drawn from rather than a
  // sample of it.
  const poisoned = {
    PATH: "/usr/bin",
    CLAUDECODE: "1",
    CLAUDE_PID: "4242",
    CLAUDE_EFFORT: "high",
    CLAUDE_CODE_ENTRYPOINT: "cli",
    CLAUDE_CODE_SESSION_ID: "abc",
    CLAUDE_CODE_CHILD_SESSION: "1",
    CLAUDE_CODE_BRIDGE_SESSION_ID: "def",
    CLAUDE_CODE_EXECPATH: "/usr/local/bin/claude",
    CLAUDE_CODE_MESSAGING_SOCKET: "/tmp/sock",
    CLAUDE_CODE_MESSAGING_TOKEN: "tok",
  };

  test("names every inherited Claude Code key for removal", () => {
    const env = taskEnv(poisoned, { taskId: "t1", port: 4000 });
    for (const key of Object.keys(poisoned)) {
      if (key === "PATH") continue;
      expect(env).toHaveProperty(key);
      expect(env[key]).toBeUndefined();
    }
  });

  // The blanket CLAUDE_CODE_ prefix scrub this replaced took these with it.
  // A user who exports CLAUDE_CODE_USE_BEDROCK or a client certificate in their
  // shell profile then got every task's agent started without it, failing to
  // authenticate while the same `claude` run by hand worked.
  test("keeps the user's own CLAUDE_CODE_ configuration, which the prefix scrub used to strip", () => {
    const userConfig = {
      CLAUDE_CODE_USE_BEDROCK: "1",
      CLAUDE_CODE_USE_MANTLE: "1",
      CLAUDE_CODE_CLIENT_CERT: "/etc/ssl/corp.pem",
      CLAUDE_CODE_CLIENT_KEY: "/etc/ssl/corp.key",
      CLAUDE_CODE_CLIENT_KEY_PASSPHRASE: "hunter2",
      CLAUDE_CODE_CERT_STORE: "/etc/ssl/store",
      CLAUDE_CODE_EFFORT_LEVEL: "high",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      CLAUDE_CODE_PROCESS_WRAPPER: "/usr/bin/wrap",
      CLAUDE_CODE_SKIP_AWS_CRED_CACHE: "1",
    };
    const env = taskEnv({ ...poisoned, ...userConfig }, { taskId: "t1" });
    for (const key of Object.keys(userConfig)) {
      expect(env).not.toHaveProperty(key);
    }
  });

  // Whatever else the messaging family grows, it is per-session IPC pointing at
  // the socket of the session that spawned the daemon — never user config — so
  // that one prefix is still swept.
  test("still sweeps the whole CLAUDE_CODE_MESSAGING_ family by prefix", () => {
    const env = taskEnv({ CLAUDE_CODE_MESSAGING_SOMETHING_NEW: "x" }, { taskId: "t1" });
    expect(env).toHaveProperty("CLAUDE_CODE_MESSAGING_SOMETHING_NEW");
    expect(env.CLAUDE_CODE_MESSAGING_SOMETHING_NEW).toBeUndefined();
  });

  test("leaves the rest of the environment alone", () => {
    // An overrides map, not a whole environment: PtyOptions.env is merged over
    // process.env, so anything not named here is inherited untouched.
    expect(taskEnv(poisoned, { taskId: "t1" })).not.toHaveProperty("PATH");
  });

  test("scrubs the fixed keys even when the daemon's own env is clean", () => {
    const env = taskEnv({ PATH: "/usr/bin" }, { taskId: "t1" });
    expect(Object.keys(env)).toContain("CLAUDECODE");
    expect(env.CLAUDECODE).toBeUndefined();
  });

  test("tells the child which task it is and where to report", () => {
    const env = taskEnv({}, { taskId: "task-7", port: 4321 });
    expect(env.CODETOASTER_TASK_ID).toBe("task-7");
    expect(env.CODETOASTER_PORT).toBe("4321");
  });

  test("omits the port when there is no server in front of us", () => {
    expect(taskEnv({}, { taskId: "task-7" })).not.toHaveProperty("CODETOASTER_PORT");
  });

  // The contract PtyOptions.env documents, and the one the scrub depends on:
  // a key named `undefined` in the merge is gone from the child, not passed
  // down as the string "undefined".
  //
  // Asserted against the keys we poisoned rather than "nothing starting with
  // CLAUDE": the scrub is deliberately narrow, and a developer who exports
  // something like CLAUDE_CONFIG_DIR is meant to have it inherited, not
  // stripped — a blanket assertion would fail on their machine over correct
  // behaviour.
  test("a spawned child sees none of the poisoned keys", async () => {
    const source = { ...process.env, ...poisoned };
    const proc = Bun.spawn(["env"], {
      env: { ...source, ...taskEnv(source, { taskId: "t1", port: 4000 }) },
      stdout: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    const keys = output.split("\n").map((line) => line.slice(0, line.indexOf("=")));
    for (const key of Object.keys(poisoned)) {
      if (key === "PATH") continue;
      expect(keys).not.toContain(key);
    }
    expect(keys).toContain("CODETOASTER_TASK_ID");
    expect(keys).toContain("CODETOASTER_PORT");
  });
});

describe("task paths", () => {
  test("settings.json sits in the task's own directory", () => {
    expect(taskSettingsPath("t1")).toBe(path.join(taskDir("t1"), "settings.json"));
    expect(taskDir("t1")).toBe(path.join(os.homedir(), ".codetoaster", "tasks", "t1"));
  });
});
