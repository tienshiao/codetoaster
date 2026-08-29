import { test, expect, describe, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { applyMigrations } from "../db";
import { TaskStore } from "./store";
import { TaskManager } from "./manager";
import { taskDir } from "../agent/spawn";

const opened: Array<{ manager: TaskManager; taskId: string }> = [];
const tempDirs: string[] = [];
const taskIds: string[] = [];

afterEach(() => {
  // PTYs are real processes; a leaked one outlives the test run.
  for (const { manager, taskId } of opened.splice(0)) manager.closeTask(taskId);
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  for (const id of taskIds.splice(0)) fs.rmSync(taskDir(id), { recursive: true, force: true });
});

/** A stand-in agent that records how it was invoked and fails on demand. It
 * fails the way the real binary does on an unusable conversation: one line and
 * exit 1 (verified against claude 2.1.251). */
function standInAgent(failWhen: string[]): { bin: string; invocations: () => string[][] } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-resume-"));
  tempDirs.push(dir);
  const log = path.join(dir, "invocations");
  const bin = path.join(dir, "agent");
  // Each invocation appends its argv as one tab-separated line, then either
  // dies or sits on the PTY the way a running agent does.
  fs.writeFileSync(
    bin,
    `#!/bin/sh
printf '%s\\t' "$@" >> ${log}
printf '\\n' >> ${log}
for bad in ${failWhen.join(" ")}; do
  case "$*" in
    *"$bad"*) echo "No conversation found"; exit 1 ;;
  esac
done
exec cat
`,
  );
  fs.chmodSync(bin, 0o755);
  return {
    bin,
    invocations: () =>
      fs.existsSync(log)
        ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => line.split("\t").filter(Boolean))
        : [],
  };
}

function suspendedTask(
  manager: TaskManager,
  store: TaskStore,
  overrides: Partial<Parameters<TaskStore["create"]>[0]> = {},
) {
  const id = `test-${crypto.randomUUID()}`;
  taskIds.push(id);
  opened.push({ manager, taskId: id });
  // A directory of its own, so the derived transcripts directory for this task
  // does not exist and cannot be confused with the real one belonging to
  // whoever is running the suite.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-cwd-"));
  tempDirs.push(cwd);
  return store.create({
    id,
    project_id: "general",
    title: "resume me",
    initial_prompt: "the original prompt",
    repo_root: null,
    cwd,
    agent_session_id: "stored-session-id",
    lifecycle: "suspended",
    agent_state: "unknown",
    ...overrides,
  });
}

function newManager(failWhen: string[] = []) {
  const db = new Database(":memory:");
  applyMigrations(db);
  const manager = new TaskManager(db);
  const agent = standInAgent(failWhen);
  process.env.CODETOASTER_AGENT_BIN = agent.bin;
  // Short, so the "it stayed alive" cap resolves quickly; a hook or an exit
  // still settles it sooner, which is what the hook test below shows.
  manager.setStartTimeout(400);
  manager.setHookGrace(10_000);
  return { manager, store: new TaskStore(db), agent };
}

describe("resuming a suspended task", () => {
  test("asks for the conversation the row remembers", async () => {
    const { manager, store, agent } = newManager();
    const row = suspendedTask(manager, store);

    const resumed = await manager.resumeTask(row.id);

    expect(resumed!.lifecycle).toBe("live");
    expect(manager.primaryPty(row.id)).toBeDefined();
    const [first] = agent.invocations();
    expect(first).toContain("--resume");
    expect(first![first!.indexOf("--resume") + 1]).toBe("stored-session-id");
    // A resumed conversation already holds the prompt that opened it.
    expect(first).not.toContain("the original prompt");
  });

  test("falls back to --continue when the stored conversation is gone", async () => {
    const { manager, store, agent } = newManager(["--resume"]);
    const row = suspendedTask(manager, store);

    const resumed = await manager.resumeTask(row.id);

    expect(resumed!.lifecycle).toBe("live");
    const modes = agent.invocations().map((argv) => argv.find((a) => a.startsWith("--resume") || a === "--continue"));
    expect(modes).toEqual(["--resume", "--continue"]);
  });

  test("scans for a conversation nobody told us about, and never re-tries the one that failed", async () => {
    const { manager, store, agent } = newManager(["stored-session-id", "--continue"]);
    // A transcript directory with two conversations: the one the row names,
    // and a newer one it has never heard of.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-transcripts-"));
    tempDirs.push(dir);
    fs.writeFileSync(path.join(dir, "stored-session-id.jsonl"), "{}");
    fs.writeFileSync(path.join(dir, "found-by-scanning.jsonl"), "{}");

    const row = suspendedTask(manager, store, { created_at: Date.now() - 60_000 });
    store.update(row.id, { transcript_path: path.join(dir, "stored-session-id.jsonl") });

    await manager.resumeTask(row.id);

    const invocations = agent.invocations();
    const ids = invocations.map((argv) => argv[argv.indexOf("--resume") + 1]);
    expect(ids[0]).toBe("stored-session-id");
    expect(ids.at(-1)).toBe("found-by-scanning");
    // And `--continue` is never reached, because the newest conversation in
    // that directory is not the one this task reported — it would have opened
    // somebody else's.
    expect(invocations.flat()).not.toContain("--continue");
  });

  // The rung that recovers a row whose id has gone stale: transcript_path came
  // from the agent's own SessionStart, and the file it names *is* the
  // conversation, whatever the row now says.
  test("resumes the conversation the task itself reported when the stored id is wrong", async () => {
    const { manager, store, agent } = newManager();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-transcripts-"));
    tempDirs.push(dir);
    fs.writeFileSync(path.join(dir, "what-really-happened.jsonl"), "{}");

    const row = suspendedTask(manager, store, { agent_session_id: "stale-id" });
    store.update(row.id, { transcript_path: path.join(dir, "what-really-happened.jsonl") });

    const resumed = await manager.resumeTask(row.id);

    expect(resumed!.lifecycle).toBe("live");
    // The stored id is not merely tried-and-failed, it is never tried: there
    // is no transcript for it in the task's directory, and a doomed --resume
    // in a PTY does not announce itself by exiting.
    const ids = agent.invocations().map((argv) => argv[argv.indexOf("--resume") + 1]);
    expect(ids).toEqual(["what-really-happened"]);
  });

  test("a conversation older than the task is not this task's conversation", async () => {
    const { manager, store, agent } = newManager(["--resume", "--continue"]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-transcripts-"));
    tempDirs.push(dir);
    const stale = path.join(dir, "someone-elses.jsonl");
    fs.writeFileSync(stale, "{}");
    // Touched long before this task existed: it belongs to whatever was using
    // the directory before.
    const old = new Date(Date.now() - 86_400_000);
    fs.utimesSync(stale, old, old);

    const row = suspendedTask(manager, store, { created_at: Date.now() - 60_000 });
    // A transcript the row names and that is no longer on disk.
    store.update(row.id, { transcript_path: path.join(dir, "gone.jsonl") });
    const resumed = await manager.resumeTask(row.id);

    // Nothing is tried at all, and that is the point. The task's own
    // transcript is gone, and the only conversation in the directory predates
    // the task — so it belongs to something else. Opening a stranger's
    // conversation would be worse than offering to start fresh.
    expect(agent.invocations()).toHaveLength(0);
    expect(resumed!.agent_state).toBe("could_not_resume");
  });

  test("when nothing opens, the task is a card with a button, not a dead terminal", async () => {
    const { manager, store, agent } = newManager(["--resume", "--continue"]);
    // No transcript_path, so nothing can rule `--continue` out: both rungs run
    // and both fail.
    const row = suspendedTask(manager, store);

    const resumed = await manager.resumeTask(row.id);

    expect(resumed!.agent_state).toBe("could_not_resume");
    expect(resumed!.lifecycle).toBe("suspended");
    expect(manager.primaryPty(row.id)).toBeUndefined();
    expect(agent.invocations()).toHaveLength(2);
  });

  // Found in live verification: hooks from a task's *previous* agent made the
  // next resume think the new process had already checked in, so the first
  // rung was declared a success however dead it was, and the ladder never ran.
  test("hooks from the last agent do not vouch for the next one", async () => {
    const { manager, store, agent } = newManager(["stored-session-id"]);
    const row = suspendedTask(manager, store);

    // A first life, which reports in the way a working agent does.
    manager.applyHook(row.id, { hook_event_name: "SessionStart", session_id: "stored-session-id" });
    manager.closeTask(row.id);
    store.create({ ...row, pinned: false, lifecycle: "suspended", agent_session_id: "stored-session-id" });

    await manager.resumeTask(row.id);

    // The failing first rung must not be mistaken for a success.
    expect(agent.invocations().length).toBeGreaterThan(1);
  });

  // A rung that failed is killed on the way to the next one, and its exit
  // callback lands afterwards. It must not stamp the task it no longer owns.
  test("a failed rung's death does not follow the task that recovered", async () => {
    const { manager, store } = newManager(["--resume"]);
    const row = suspendedTask(manager, store);

    const resumed = await manager.resumeTask(row.id);
    expect(resumed!.lifecycle).toBe("live");

    // Long enough for the discarded PTY's exit to have been delivered.
    await Bun.sleep(300);
    expect(store.get(row.id)!.agent_state).not.toBe("exited");
    expect(manager.primaryPty(row.id)).toBeDefined();
  });

  test("starting fresh mints a new id rather than reusing a spent one", async () => {
    const { manager, store, agent } = newManager();
    const row = suspendedTask(manager, store);

    const resumed = await manager.resumeTask(row.id, { fresh: true });

    // A used --session-id fails with "already in use", so reusing the stored
    // one would fail a second time and strand the task in a retry loop.
    expect(resumed!.agent_session_id).not.toBe("stored-session-id");
    expect(resumed!.agent_session_id).toMatch(/^[0-9a-f-]{36}$/);
    const [argv] = agent.invocations();
    expect(argv).toContain("--session-id");
    expect(argv![argv!.indexOf("--session-id") + 1]).toBe(resumed!.agent_session_id!);
    expect(argv).not.toContain("--resume");
  });

  test("resuming a task that is already running changes nothing", async () => {
    const { manager, store, agent } = newManager();
    const row = suspendedTask(manager, store);
    await manager.resumeTask(row.id);
    const ptyId = manager.primaryPty(row.id)!.id;

    await manager.resumeTask(row.id);

    expect(manager.primaryPty(row.id)!.id).toBe(ptyId);
    expect(agent.invocations()).toHaveLength(1);
  });

  test("restores the grid the task was suspended at", async () => {
    const { manager, store } = newManager();
    const row = suspendedTask(manager, store, { });
    store.update(row.id, { last_size_cols: 133, last_size_rows: 41 });

    await manager.resumeTask(row.id);

    expect(manager.primaryPty(row.id)!.getSize()).toEqual({ cols: 133, rows: 41 });
  });

  // The cap is 400ms here; a hook settles it well inside that, which is the
  // point of deciding on the hook rather than on a timer.
  test("a hook settles the start sooner than the cap", async () => {
    const { manager, store } = newManager();
    manager.setStartTimeout(5_000);
    const row = suspendedTask(manager, store);

    const started = Date.now();
    const resuming = manager.resumeTask(row.id);
    // The agent reports in, the way a real one does through `codetoaster hook`.
    setTimeout(() => manager.applyHook(row.id, { hook_event_name: "SessionStart", session_id: "reported" }), 60);
    const resumed = await resuming;

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(resumed!.lifecycle).toBe("live");
    // And the row picks up whatever conversation actually opened.
    expect(resumed!.agent_session_id).toBe("reported");
  });
});
