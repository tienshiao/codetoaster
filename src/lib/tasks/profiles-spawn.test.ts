import { test, expect, describe, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { applyMigrations } from "../db";
import { TaskStore } from "./store";
import { TaskManager } from "./manager";
import { taskDir, taskSettingsPath } from "../agent/spawn";
import { builtinProfiles, type AgentProfile } from "../agent/profile";
import { ProfileRegistry, UnknownProfileError } from "../agent/profiles";

// TASK-89.2: a task runs on the profile it was created with, and every spawn
// for it — the create and, later, the resume — renders its argv through that
// profile's templates. Asserted against a stand-in that records how it was
// invoked, because the whole of what a profile does is decide an argv.

const managers: TaskManager[] = [];
const tempDirs: string[] = [];
const taskIds: string[] = [];

afterEach(async () => {
  // PTYs are real processes; a leaked one outlives the test run. Awaited
  // because delete also cleans up on disk (TASK-31).
  for (const manager of managers.splice(0)) {
    for (const task of manager.listTasks()) await manager.deleteTask(task.id);
  }
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  // Anything the create wrote for a task that never reached `listTasks` — the
  // failed creates below, and the claude task's settings.json.
  for (const id of taskIds.splice(0)) fs.rmSync(taskDir(id), { recursive: true, force: true });
});

/** A stand-in agent that records its argv, one tab-separated line per
 * invocation, and then sits on the PTY the way a running agent does. The same
 * script `resume.test.ts` uses, without the failure arm: nothing here is about
 * a rung that dies, only about what each rung was asked to run.
 *
 * It reports no hooks, which is the honest shape for the profile it stands in
 * for — a profile with no `{settings}` has nowhere to load ours from. So the
 * resume below settles on `awaitAgentStart`'s cap rather than on a hook, and
 * the cap is set short for exactly that reason. */
function recordingAgent(): {
  bin: string;
  settled: (n: number) => Promise<string[][]>;
  invocations: () => string[][];
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-profiles-"));
  tempDirs.push(dir);
  const log = path.join(dir, "invocations");
  const bin = path.join(dir, "agent");
  fs.writeFileSync(
    bin,
    `#!/bin/sh
printf '%s\\t' "$@" >> "${log}"
printf '\\n' >> "${log}"
exec cat
`,
  );
  fs.chmodSync(bin, 0o755);
  const read = () =>
    fs.existsSync(log)
      ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean)
        .map((line) => line.split("\t").filter(Boolean))
      : [];
  return {
    bin,
    /** The stand-in writes its line from a child process, so reading the log
     * the instant a create or a resume resolves races it. */
    settled: async (n: number) => {
      for (let i = 0; i < 60 && read().length < n; i++) await Bun.sleep(25);
      return read();
    },
    invocations: read,
  };
}

/** pi's templates against the recording stand-in: a session id we choose up
 * front and that serves start and resume alike, a model, the prompt behind
 * `--`, and no `{settings}` at all. */
function recProfile(bin: string): AgentProfile {
  return {
    name: "rec",
    label: "rec",
    bin,
    start: ["--session-id", "{session_id}", "--model", "{model}", "--", "{prompt}"],
    resume: ["--session-id", "{session_id}", "--model", "{model}"],
    continue: ["--continue", "--model", "{model}"],
  };
}

function newManager() {
  const db = new Database(":memory:");
  applyMigrations(db);
  const manager = new TaskManager(db);
  managers.push(manager);
  const agent = recordingAgent();
  // The claude profile's binary too, so nothing here can spawn a real agent
  // even on the default path. (`test/preload.ts` already points this at
  // `fake-agent.sh` before every test; this narrows it to the one that records.)
  process.env.CODETOASTER_AGENT_BIN = agent.bin;
  manager.setProfiles(new ProfileRegistry([...builtinProfiles(), recProfile(agent.bin)]));
  // The stand-in reports no hooks, so a resume settles on the cap — short,
  // since nothing here is waiting for a signal that could arrive instead.
  manager.setStartTimeout(150);
  manager.setHookGrace(10_000);
  return { manager, store: new TaskStore(db), agent };
}

function newTaskId(): string {
  const id = `test-${crypto.randomUUID()}`;
  taskIds.push(id);
  return id;
}

describe("creating a task on a profile", () => {
  test("renders the argv through the profile's start template", async () => {
    const { manager, store, agent } = newManager();
    const id = newTaskId();

    const row = await manager.createTask({ id, profile: "rec", prompt: "go", model: "m" });

    expect(row.agent_profile).toBe("rec");
    const [argv] = await agent.settled(1);
    expect(argv).toEqual([
      "--session-id", row.agent_session_id!,
      "--model", "m",
      "--", "go",
    ]);
    // The id is the one on the row, which is what makes the resume below able
    // to ask for the same conversation back.
    expect(store.get(id)!.agent_session_id).toBe(row.agent_session_id);
  });

  test("writes no settings.json for a profile with nowhere to point at one", async () => {
    const { manager } = newManager();
    const id = newTaskId();

    await manager.createTask({ id, profile: "rec", prompt: "go" });

    expect(fs.existsSync(taskSettingsPath(id))).toBe(false);
    // Not even the directory: a file nothing reads is a directory per task for
    // no reason.
    expect(fs.existsSync(taskDir(id))).toBe(false);
  });

  test("the profile is on the wire", async () => {
    const { manager } = newManager();
    const id = newTaskId();

    await manager.createTask({ id, profile: "rec", prompt: "go" });

    expect(manager.taskInfo(id)!.profile).toBe("rec");
  });

  test("a task that names no profile is a claude task, hooks and all", async () => {
    const { manager, store, agent } = newManager();
    const id = newTaskId();

    await manager.createTask({ id, prompt: "go", model: "m" });

    expect(store.get(id)!.agent_profile).toBe("claude");
    expect(manager.taskInfo(id)!.profile).toBe("claude");
    expect(fs.existsSync(taskSettingsPath(id))).toBe(true);
    const [argv] = await agent.settled(1);
    expect(argv).toContain("--settings");
    expect(argv).toContain(taskSettingsPath(id));
  });

  // The name reaches the manager from a route, so it is the caller's typo far
  // more often than a bug — and it has to fail before anything exists to undo.
  test("an unknown profile is refused, leaving no row and nothing spawned", async () => {
    const { manager, store, agent } = newManager();
    const id = newTaskId();

    await expect(manager.createTask({ id, profile: "nope", prompt: "go" }))
      .rejects.toThrow(UnknownProfileError);

    expect(store.get(id)).toBeUndefined();
    expect(manager.taskInfo(id)).toBeUndefined();
    expect(agent.invocations()).toEqual([]);
  });
});

describe("resuming a task on a profile", () => {
  // The whole point of the column: months later, the resume has to render the
  // templates the conversation was opened with. pi's resume is `--session-id`
  // on the same id, not claude's `--resume`.
  test("comes back through the profile's own resume template", async () => {
    const { manager, store, agent } = newManager();
    const id = newTaskId();
    const row = await manager.createTask({ id, profile: "rec", prompt: "go", model: "m" });
    // Waited for before the close, not merely counted afterwards: the stand-in
    // records from a child process a couple of hundred milliseconds after the
    // spawn returns, and a close arriving first kills it before it writes — so
    // the resume's line would come back as the *first* invocation and the
    // assertions below would be reading the wrong one.
    await agent.settled(1);

    expect(await manager.closeTask(id)).toBe(true);
    expect(store.get(id)!.lifecycle).toBe("suspended");

    const resumed = await manager.resumeTask(id);

    expect(resumed!.lifecycle).toBe("live");
    const [, second] = await agent.settled(2);
    expect(second).toContain("--session-id");
    expect(second![second!.indexOf("--session-id") + 1]).toBe(row.agent_session_id!);
    // claude's flag, on a profile that has no such thing.
    expect(second).not.toContain("--resume");
    // A resumed conversation already holds the prompt that opened it.
    expect(second).not.toContain("go");
    // And still no settings file, on the resume path as on the create's.
    expect(fs.existsSync(taskSettingsPath(id))).toBe(false);
  });

  // A profile with neither `resume` nor `continue` has no ladder at all, which
  // is a card with a button rather than a lie about being live (TASK-89.4 turns
  // it into a restart).
  test("a profile that cannot resume leaves the task saying so", async () => {
    const { manager, store } = newManager();
    const id = newTaskId();
    await manager.createTask({ id, profile: "shell" });

    expect(await manager.closeTask(id)).toBe(true);
    const resumed = await manager.resumeTask(id);

    expect(resumed!.lifecycle).toBe("suspended");
    expect(resumed!.agent_state).toBe("could_not_resume");
    expect(store.get(id)!.agent_profile).toBe("shell");
  });
});
