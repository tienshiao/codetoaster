import { test, expect, describe, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { applyMigrations } from "../db";
import { TaskStore } from "./store";
import { TaskManager } from "./manager";
import { taskDir } from "../agent/spawn";
import { projectsDirFor } from "../agent/transcripts";

const opened: Array<{ manager: TaskManager; taskId: string }> = [];
const tempDirs: string[] = [];
const taskIds: string[] = [];

afterEach(() => {
  // PTYs are real processes; a leaked one outlives the test run.
  for (const { manager, taskId } of opened.splice(0)) manager.deleteTask(taskId);
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  for (const id of taskIds.splice(0)) fs.rmSync(taskDir(id), { recursive: true, force: true });
});

/** A stand-in agent that records how it was invoked and fails on demand. It
 * fails the way the real binary does on an unusable conversation: one line and
 * exit 1 (verified against claude 2.1.251). */
function standInAgent(failWhen: string[]): {
  bin: string;
  settled: (n: number) => Promise<string[][]>;
  invocations: () => string[][];
} {
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
  const read = () =>
    fs.existsSync(log)
      ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => line.split("\t").filter(Boolean))
      : [];
  return {
    bin,
    /** Waits for at least `n` invocations to have been recorded. The stand-in
     * writes its line from a child process, so reading the log the instant
     * resumeTask resolves races it — the ladder can be finished while the last
     * rung's shell has not flushed yet. */
    settled: async (n: number) => {
      for (let i = 0; i < 60 && read().length < n; i++) await Bun.sleep(25);
      return read();
    },
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
  //
  // Not *too* short, though: the stand-in is a `/bin/sh` script, and a failing
  // rung has to be spawned, exec'd, write its log line and exit before the cap
  // decides it stayed alive. At 400ms a loaded machine lost that race often
  // enough to fail the ladder tests roughly one run in six — the cap fired
  // first and the failing rung was recorded as a success (`starting` rather
  // than `could_not_resume`).
  manager.setStartTimeout(400);
  manager.setHookGrace(10_000);
  return { manager, store: new TaskStore(db), agent };
}

describe("resuming a suspended task", () => {
  // AC #2/#3. The daemon's PTYs died with it, so every `live` row at boot is a
  // lie; what makes that a suspend rather than the v1 wipe is that the row it
  // leaves behind is one `resumeTask` away from running again. `bun --hot`
  // takes exactly this path on every reload.
  test("a task the previous daemon left running comes back after a restart", async () => {
    const { manager, store, agent } = newManager();
    const row = suspendedTask(manager, store, {
      lifecycle: "live",
      agent_state: "busy",
    });
    manager.loadProjects();

    expect(manager.reconcileOnBoot()).toBe(1);
    expect(store.get(row.id)!.lifecycle).toBe("suspended");
    // Not gone: a client connecting after the restart is sent it.
    expect(manager.listTasks().map((t) => t.id)).toContain(row.id);

    const resumed = await manager.resumeTask(row.id);

    expect(resumed!.lifecycle).toBe("live");
    expect(manager.primaryPty(row.id)).toBeDefined();
    expect((await agent.settled(1))[0]).toContain("--resume");
  });

  test("asks for the conversation the row remembers", async () => {
    const { manager, store, agent } = newManager();
    const row = suspendedTask(manager, store);

    const resumed = await manager.resumeTask(row.id);

    expect(resumed!.lifecycle).toBe("live");
    expect(manager.primaryPty(row.id)).toBeDefined();
    const [first] = await agent.settled(1);
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
    const modes = (await agent.settled(2)).map((argv) => argv.find((a) => a.startsWith("--resume") || a === "--continue"));
    expect(modes).toEqual(["--resume", "--continue"]);
  });

  // A directory holding somebody else's newer conversation: neither the guess
  // that opens "the most recent one" nor the scan that looks for a candidate
  // may run, because both would land on the stranger. Gating one and not the
  // other would have made the guard theatre.
  test("guesses nothing in a directory it can see is shared", async () => {
    const { manager, store, agent } = newManager(["stored-session-id"]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-transcripts-"));
    tempDirs.push(dir);
    fs.writeFileSync(path.join(dir, "stored-session-id.jsonl"), "{}");
    fs.writeFileSync(path.join(dir, "someone-elses.jsonl"), "{}");

    const row = suspendedTask(manager, store, { created_at: Date.now() - 60_000 });
    store.update(row.id, { transcript_path: path.join(dir, "stored-session-id.jsonl") });

    const resumed = await manager.resumeTask(row.id);

    const invocations = await agent.settled(1);
    // The task's own conversation is still tried — it is named, not guessed.
    expect(invocations).toHaveLength(1);
    expect(invocations[0]![invocations[0]!.indexOf("--resume") + 1]).toBe("stored-session-id");
    expect(invocations.flat()).not.toContain("--continue");
    expect(resumed!.agent_state).toBe("could_not_resume");
  });

  // And where the directory is the task's own — which is what worktree-per-task
  // makes true for every task (m-4) — the scan is exactly the rung §4.3 wants.
  test("scans for a conversation nobody told us about when the directory is its own", async () => {
    // `--continue` fails too, so the ladder gets as far as the scan.
    const { manager, store, agent } = newManager(["stored-session-id", "--continue"]);
    // A row that has never had a hook report a transcript path, so the
    // directory is the derived one for its cwd.
    const row = suspendedTask(manager, store, { created_at: Date.now() - 60_000 });
    const derived = projectsDirFor(store.get(row.id)!.cwd);
    fs.mkdirSync(derived, { recursive: true });
    tempDirs.push(derived);
    fs.writeFileSync(path.join(derived, "found-by-scanning.jsonl"), "{}");

    await manager.resumeTask(row.id);

    const ids = (await agent.settled(1)).map((argv) => argv[argv.indexOf("--resume") + 1]);
    // The stored id has no transcript here, so it is never attempted; the
    // conversation that is actually present is.
    expect(ids).toContain("found-by-scanning");
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
    const ids = (await agent.settled(1)).map((argv) => argv[argv.indexOf("--resume") + 1]);
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
    expect(await agent.settled(2)).toHaveLength(2);
  });

  // Found in live verification: hooks from a task's *previous* agent made the
  // next resume think the new process had already checked in, so the first
  // rung was declared a success however dead it was, and the ladder never ran.
  test("hooks from the last agent do not vouch for the next one", async () => {
    const { manager, store, agent } = newManager(["stored-session-id"]);
    const row = suspendedTask(manager, store);

    // A first life, which reports in the way a working agent does.
    manager.applyHook(row.id, { hook_event_name: "SessionStart", session_id: "stored-session-id" });
    manager.deleteTask(row.id);
    store.create({ ...row, pinned: false, lifecycle: "suspended", agent_session_id: "stored-session-id" });

    await manager.resumeTask(row.id);

    // The failing first rung must not be mistaken for a success.
    expect((await agent.settled(2)).length).toBeGreaterThan(1);
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
    const [argv] = await agent.settled(1);
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
    expect(await agent.settled(1)).toHaveLength(1);
  });

  // The ladder adopts each rung's terminal before it knows whether that rung
  // worked, so for most of a resume there is a live PTY on the task belonging to
  // an attempt still being judged. Reading that as "already running" answered a
  // second caller with a suspended row and the ptyId of a terminal the first
  // caller may be about to discard.
  test("a second resume joins the first rather than answering out of its unfinished ladder", async () => {
    const { manager, store } = newManager();
    const row = suspendedTask(manager, store);

    const first = manager.resumeTask(row.id);
    // The window a second caller actually lands in: the rung's terminal is up,
    // and the ladder has not yet decided anything about it.
    while (!manager.primaryPty(row.id)) await Bun.sleep(5);

    const second = await manager.resumeTask(row.id);

    expect(second).toBe(await first);
    expect(second!.lifecycle).toBe("live");
  });

  // The row stays `suspended` for the whole of the ladder and only turns
  // `live` on the rung that works, so a close arriving mid-resume read "not
  // live", did nothing, and reported success — and seconds later the ladder
  // handed the user back the agent they had just closed.
  test("a close that lands mid-resume closes the task the resume produced", async () => {
    const { manager, store } = newManager();
    const row = suspendedTask(manager, store);

    const resume = manager.resumeTask(row.id);
    while (!manager.primaryPty(row.id)) await Bun.sleep(5);

    const closed = await manager.closeTask(row.id);
    await resume;

    expect(closed).toBe(true);
    expect(store.get(row.id)!.lifecycle).toBe("suspended");
    expect(manager.primaryPty(row.id)).toBeUndefined();
  });

  // "Safe to ask for twice" is about a plain resume. A fresh start is a request
  // for a new conversation, and answering it with the running one returned 200
  // having minted nothing — with a body describing the old session, so the
  // caller could not tell.
  test("a fresh start replaces a conversation that is already running", async () => {
    const { manager, store, agent } = newManager();
    const row = suspendedTask(manager, store);
    await manager.resumeTask(row.id);
    const ptyId = manager.primaryPty(row.id)!.id;

    const fresh = await manager.resumeTask(row.id, { fresh: true });

    expect(fresh!.agent_session_id).not.toBe("stored-session-id");
    expect(manager.primaryPty(row.id)!.id).not.toBe(ptyId);
    const [, second] = await agent.settled(2);
    expect(second).toContain("--session-id");
    expect(second).not.toContain("--resume");
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

  // PtyManager only forgets a PTY when something kills it, so one that exited
  // on its own stays registered and `primaryPty` goes on answering with the
  // corpse. Testing that handle alone made resume a permanent no-op for the
  // case it most obviously exists to serve: an agent that exited while the
  // daemon stayed up.
  test("resumes a task whose agent exited, rather than reporting the corpse", async () => {
    const { manager, store, agent } = newManager();
    const row = suspendedTask(manager, store);

    // A first life that comes up and then dies, the way an agent does when the
    // user exits it.
    await manager.resumeTask(row.id);
    const first = manager.primaryPty(row.id);
    expect(first).toBeDefined();
    // Killed through the Pty itself, not through PtyManager, so it stays
    // registered exactly as a process that exited on its own would have. The
    // wait is for the real exit to land: `exited` is set from the async
    // callback, not by asking for the kill.
    first!.kill();
    for (let i = 0; i < 100 && !first!.exited; i++) await Bun.sleep(10);
    expect(first!.exited).toBe(true);

    const before = agent.invocations().length;
    const resumed = await manager.resumeTask(row.id);

    // A new process, and a new terminal to attach to.
    expect((await agent.settled(before + 1)).length).toBeGreaterThan(before);
    expect(resumed!.lifecycle).toBe("live");
    expect(manager.primaryPty(row.id)?.id).not.toBe(first!.id);
    expect(manager.primaryPty(row.id)?.exited).toBe(false);
  });
});
