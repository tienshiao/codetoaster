import { test, expect, describe, afterEach } from "bun:test";
import * as fs from "fs";
import {
  HOOK_EVENTS,
  buildSettings,
  hookCommand,
  hookCommandFrom,
  isCompiledBinary,
  writeTaskSettings,
} from "./settings";
import { taskDir, taskSettingsPath } from "./spawn";

describe("buildSettings", () => {
  test("registers every event in the §4.2 table against the one command", () => {
    const settings = buildSettings("codetoaster hook");

    expect(Object.keys(settings.hooks).sort()).toEqual([...HOOK_EVENTS].sort());
    expect(HOOK_EVENTS).toEqual([
      "SessionStart",
      "UserPromptSubmit",
      "Stop",
      "Notification",
      "SessionEnd",
      "PreCompact",
    ]);
    for (const event of HOOK_EVENTS) {
      const groups = settings.hooks[event];
      expect(groups).toHaveLength(1);
      expect(groups[0]!.hooks).toEqual([
        { type: "command", command: "codetoaster hook", timeout: expect.any(Number) },
      ]);
    }
  });

  // No matcher is how an event says "every occurrence". SessionStart in
  // particular must fire on `resume` and `clear` as well as `startup` — a
  // /clear starts a new conversation id, and missing it strands the stored one.
  test("carries no matcher, so nothing is filtered out", () => {
    const settings = buildSettings("x");
    for (const event of HOOK_EVENTS) {
      expect(settings.hooks[event]![0]!).not.toHaveProperty("matcher");
    }
  });

  test("bounds how long a hook can hold up the agent", () => {
    const timeout = buildSettings("x").hooks.Stop[0]!.hooks[0]!.timeout;
    expect(timeout).toBeGreaterThan(0);
    expect(timeout).toBeLessThanOrEqual(10);
  });

  test("serializes to JSON a settings file can hold", () => {
    const parsed = JSON.parse(JSON.stringify(buildSettings("codetoaster hook")));
    expect(parsed.hooks.SessionStart[0].hooks[0].command).toBe("codetoaster hook");
  });
});

describe("hookCommand", () => {
  // Probed against a real `bun build --compile` binary: Bun.main is
  // /$bunfs/root/<name> there, and fs.existsSync on it returns true — which is
  // why the marker, not the file, decides.
  test("recognises a compiled binary by its embedded main path", () => {
    expect(isCompiledBinary("/$bunfs/root/codetoaster")).toBe(true);
    expect(isCompiledBinary("B:\\~BUN\\root\\codetoaster")).toBe(true);
    expect(isCompiledBinary("/Users/me/codetoaster/src/index.ts")).toBe(false);
  });

  test("a compiled binary runs itself", () => {
    expect(hookCommandFrom("/usr/local/bin/codetoaster", "/$bunfs/root/codetoaster"))
      .toBe("'/usr/local/bin/codetoaster' hook");
  });

  test("a script runs under the runtime that is running it", () => {
    expect(hookCommandFrom("/Users/me/.bun/bin/bun", "/Users/me/codetoaster/src/index.ts"))
      .toBe("'/Users/me/.bun/bin/bun' '/Users/me/codetoaster/src/index.ts' hook");
  });

  // The daemon lives wherever the user put it, and the string goes to a shell.
  test("survives a path with spaces, and one with a quote in it", () => {
    expect(hookCommandFrom("/Users/me/My Tools/codetoaster", "/$bunfs/root/x"))
      .toBe("'/Users/me/My Tools/codetoaster' hook");
    expect(hookCommandFrom("/tmp/it's here/codetoaster", "/$bunfs/root/x"))
      .toBe("'/tmp/it'\\''s here/codetoaster' hook");
  });

  test("names this very process, so a hook could actually run", () => {
    expect(hookCommand()).toContain(process.execPath);
    expect(hookCommand().endsWith(" hook")).toBe(true);
  });
});

describe("writeTaskSettings", () => {
  const written: string[] = [];
  afterEach(() => {
    for (const id of written.splice(0)) {
      fs.rmSync(taskDir(id), { recursive: true, force: true });
    }
  });

  test("creates the task's directory on demand and writes the file into it", async () => {
    const id = `test-${crypto.randomUUID()}`;
    written.push(id);
    expect(fs.existsSync(taskDir(id))).toBe(false);

    const settingsPath = await writeTaskSettings(id, "codetoaster hook");

    expect(settingsPath).toBe(taskSettingsPath(id));
    const parsed = JSON.parse(await Bun.file(settingsPath).text());
    expect(Object.keys(parsed.hooks).sort()).toEqual([...HOOK_EVENTS].sort());
    expect(parsed.hooks.SessionEnd[0].hooks[0].command).toBe("codetoaster hook");
  });

  // A daemon that moved must not leave a task pointing at a command line that
  // no longer resolves, since a hook that fails is a hook that never reports.
  test("rewrites a file that is already there", async () => {
    const id = `test-${crypto.randomUUID()}`;
    written.push(id);
    await writeTaskSettings(id, "/old/path hook");
    await writeTaskSettings(id, "/new/path hook");

    const parsed = JSON.parse(await Bun.file(taskSettingsPath(id)).text());
    expect(parsed.hooks.Stop[0].hooks[0].command).toBe("/new/path hook");
  });
});
