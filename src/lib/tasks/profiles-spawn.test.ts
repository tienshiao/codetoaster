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
import { waitFor } from "../../../test/wait";

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
function recordingAgent({ speaks = false }: { speaks?: boolean } = {}): {
  bin: string;
  settled: (n: number) => Promise<string[][]>;
  invocations: () => string[][];
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-profiles-"));
  tempDirs.push(dir);
  const log = path.join(dir, "invocations");
  const bin = path.join(dir, "agent");
  // `speaks` puts one line on the *terminal* rather than in the log, which is
  // the only signal a hookless task has to offer: the degraded-mode heuristic
  // reads busy off output arriving and idle off it stopping. The default is
  // silent, because a task that never paints is the sharper case for "a
  // hookless profile is not relabelled behind its own back".
  fs.writeFileSync(
    bin,
    `#!/bin/sh
printf '%s\\t' "$@" >> "${log}"
printf '\\n' >> "${log}"
${speaks ? `printf 'working\\n'` : ""}
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

/** A profile with a `start` template and nothing else — the shape a shell task
 * has, against the recording stand-in so a reopen can be read off its argv.
 * The ladder answers this with a single `restart` rung (TASK-89.4). */
function startOnlyProfile(bin: string): AgentProfile {
  return {
    name: "once",
    label: "once",
    bin,
    start: ["--session-id", "{session_id}", "--", "{prompt}"],
  };
}

function newManager({ speaks = false }: { speaks?: boolean } = {}) {
  const db = new Database(":memory:");
  applyMigrations(db);
  const manager = new TaskManager(db);
  managers.push(manager);
  const agent = recordingAgent({ speaks });
  // The claude profile's binary too, so nothing here can spawn a real agent
  // even on the default path. (`test/preload.ts` already points this at
  // `fake-agent.sh` before every test; this narrows it to the one that records.)
  process.env.CODETOASTER_AGENT_BIN = agent.bin;
  manager.setProfiles(
    new ProfileRegistry([...builtinProfiles(), recProfile(agent.bin), startOnlyProfile(agent.bin)]),
  );
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

  // A profile with neither `resume` nor `continue` gets one rung: the start
  // command again, in the task's own directory (TASK-89.4). Better than a dead
  // card — a shell task's whole purpose is a terminal there — and honest,
  // because the DTO says the conversation did not come back.
  test("a profile that cannot resume restarts, and says that is what happened", async () => {
    const { manager, store } = newManager();
    const id = newTaskId();
    await manager.createTask({ id, profile: "shell" });

    expect(await manager.closeTask(id)).toBe(true);
    const resumed = await manager.resumeTask(id);

    expect(resumed!.lifecycle).toBe("live");
    expect(resumed!.agent_state).not.toBe("could_not_resume");
    expect(store.get(id)!.agent_profile).toBe("shell");
    expect(manager.taskInfo(id)!.restarted).toBe(true);
  });

  // The argv half of the same thing, where it can be read: the start template
  // rendered again, keeping the row's id and dropping the prompt. Replaying the
  // prompt is the bug the resume rule exists to prevent, and a restart reaches
  // for the same template a start does — so it is exactly the path where it
  // could come back.
  test("the restart renders the start template without the prompt", async () => {
    const { manager, agent } = newManager();
    const id = newTaskId();
    const row = await manager.createTask({ id, profile: "once", prompt: "go" });
    const [first] = await agent.settled(1);
    expect(first).toEqual(["--session-id", row.agent_session_id!, "--", "go"]);

    expect(await manager.closeTask(id)).toBe(true);
    const resumed = await manager.resumeTask(id);

    expect(resumed!.lifecycle).toBe("live");
    const [, second] = await agent.settled(2);
    // The same conversation id, so a profile whose `--session-id` creates the
    // session if it is missing is genuinely back where it was.
    expect(second).toEqual(["--session-id", row.agent_session_id!]);
    expect(manager.taskInfo(id)!.restarted).toBe(true);
  });

  // The flag is about the process, not the task. Closing ends the process, so
  // there is nothing left for it to be true of — and a suspended card must not
  // go on saying its conversation was lost by a restart that is over.
  test("the restart flag goes with the process it describes", async () => {
    const { manager } = newManager();
    const id = newTaskId();
    await manager.createTask({ id, profile: "once", prompt: "go" });
    await manager.closeTask(id);
    await manager.resumeTask(id);
    expect(manager.taskInfo(id)!.restarted).toBe(true);

    expect(await manager.closeTask(id)).toBe(true);

    expect(manager.taskInfo(id)!.restarted).toBe(false);
  });

  // `profiles.json` is the user's file, and one edited between creating a task
  // and reopening it can drop the profile the row names. There is nothing to
  // render an argv through, so the ladder is empty and the task says it could
  // not be brought back — rather than a 500 out of an ordinary click.
  test("a profile the daemon no longer knows fails the resume, not the request", async () => {
    const { manager } = newManager();
    const id = newTaskId();
    await manager.createTask({ id, profile: "once", prompt: "go" });
    expect(await manager.closeTask(id)).toBe(true);

    manager.setProfiles(new ProfileRegistry([...builtinProfiles()]));
    const resumed = await manager.resumeTask(id);

    expect(resumed!.lifecycle).toBe("suspended");
    expect(resumed!.agent_state).toBe("could_not_resume");
    // And nothing to say about hooks either: there is no template to read.
    expect(manager.taskInfo(id)!.hooks).toBe(false);
  });
});

// §9's risk 4, reached by configuration rather than by an agent misbehaving: a
// profile whose templates never name `{settings}` has nowhere to load our hooks
// from, so it will never report one. The grace timer that ends in `unknown`
// exists to catch an agent that *should* have reported and did not, and arming
// it for one that cannot would relabel every healthy task on that profile.
describe("a task on a profile that cannot report hooks", () => {
  test("says so on the wire", async () => {
    const { manager } = newManager();
    const rec = newTaskId();
    const claude = newTaskId();

    await manager.createTask({ id: rec, profile: "rec", prompt: "go" });
    await manager.createTask({ id: claude, prompt: "go" });

    expect(manager.taskInfo(rec)!.hooks).toBe(false);
    expect(manager.taskInfo(claude)!.hooks).toBe(true);
  });

  test("is never relabelled unknown, however long it stays quiet", async () => {
    const { manager, store } = newManager();
    // Short enough that a grace armed by mistake would have fired several times
    // over by the assertion below.
    manager.setHookGrace(50);
    const id = newTaskId();

    // The silent stand-in: it sits on the PTY without painting, so there is no
    // output for the heuristic to read either. This is precisely the task that
    // used to end up `unknown` — and `unknown` would be a claim that an agent
    // owing us a report did not make one.
    await manager.createTask({ id, profile: "rec", prompt: "go" });
    expect(store.get(id)!.agent_state).toBe("starting");

    await Bun.sleep(300);

    expect(store.get(id)!.agent_state).toBe("starting");
  });

  test("reaches busy and then idle from its output alone", async () => {
    const { manager, store } = newManager({ speaks: true });
    manager.setHookGrace(50);
    const id = newTaskId();

    await manager.createTask({ id, profile: "rec", prompt: "go" });

    // v1's inference, which is all a hookless profile ever had: bytes out means
    // working...
    expect(await waitFor(() => store.get(id)!.agent_state === "busy")).toBe(true);
    // ...and the trailing debounce closing means it stopped. Neither passes
    // through `unknown` on the way.
    expect(await waitFor(() => store.get(id)!.agent_state === "idle")).toBe(true);
  });
});
