import { test, expect, describe } from "bun:test";
import * as fs from "fs";
import { buildAgentCommand } from "./spawn";
import { FAKE_AGENT_BIN } from "../../../test/agent-bin";

/**
 * The guard on the guard.
 *
 * `test/preload.ts` points `CODETOASTER_AGENT_BIN` at a harmless script for the
 * whole run, so no test file has to remember and none can start a real Claude
 * Code session by forgetting. That protection is a line in `bunfig.toml`, and
 * CLAUDE.md already records that some of bunfig's test options are honoured
 * from a shell and silently ignored under `bun run` — so the mechanism can stop
 * working without anything failing.
 *
 * These tests are what makes that loud. If the preload lapses, this is what
 * says so, in one place, instead of the suite quietly spending tokens again.
 */
describe("no test can spawn the real agent", () => {
  test("the stand-in is what the environment names", () => {
    expect(process.env.CODETOASTER_AGENT_BIN).toBe(FAKE_AGENT_BIN);
  });

  test("and it is a real, runnable file", () => {
    // The exec bit is committed but survivable-losable — `core.fileMode false`,
    // a zip round trip. Without it every spawning test fails somewhere far from
    // the cause.
    expect(fs.statSync(FAKE_AGENT_BIN).isFile()).toBe(true);
    fs.accessSync(FAKE_AGENT_BIN, fs.constants.X_OK);
  });

  test("so a task's agent command names it, not claude", () => {
    const command = buildAgentCommand({
      agent_session_id: "abc",
      initial_prompt: "",
      model: null,
      permission_mode: null,
    });

    // The assertion that actually matters: this is the argv a spawn would use.
    expect(command[0]).toBe(FAKE_AGENT_BIN);
    expect(command[0]).not.toBe("claude");
  });
});
