import { test, expect, describe, afterEach } from "bun:test";
import * as path from "path";

const CLI = path.join(import.meta.dir, "..", "index.ts");

interface HookRun {
  stdout: string;
  exitCode: number | null;
  ms: number;
}

/** Runs the real subcommand as its own process. Every acceptance criterion
 * here is about what the process does — what it writes, what it exits with,
 * how long it takes — so asserting on a function's return value would be
 * testing something else. */
async function runHook(
  stdin: string | "never-closes",
  env: Record<string, string | undefined>,
): Promise<HookRun> {
  const started = Date.now();
  const proc = Bun.spawn([process.execPath, CLI, "hook"], {
    stdin: stdin === "never-closes" ? "pipe" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CODETOASTER_TASK_ID: undefined, CODETOASTER_PORT: undefined, ...env },
  });
  const [stdout, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  return { stdout, exitCode, ms: Date.now() - started };
}

interface Received {
  url: string;
  body: string;
}

const servers: Array<{ stop: (force?: boolean) => void }> = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

/** A stand-in daemon that records what reached it. */
function fakeDaemon(handler?: (req: Request) => Response | Promise<Response>) {
  const received: Received[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      received.push({ url: new URL(req.url).pathname, body: await req.text() });
      return handler ? await handler(req) : new Response(null, { status: 204 });
    },
  });
  servers.push(server);
  return { received, port: String(server.port) };
}

/** A port nothing is listening on: opened, read, and closed again, so the
 * number is real and unclaimed rather than guessed. */
function deadPort(): string {
  const server = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = String(server.port);
  server.stop(true);
  return port;
}

describe("codetoaster hook", () => {
  test("posts the payload to the daemon under the task's id", async () => {
    const daemon = fakeDaemon();
    const payload = JSON.stringify({ session_id: "abc", hook_event_name: "Stop" });

    const run = await runHook(payload, {
      CODETOASTER_TASK_ID: "task-1",
      CODETOASTER_PORT: daemon.port,
    });

    expect(run.exitCode).toBe(0);
    expect(daemon.received).toHaveLength(1);
    expect(daemon.received[0]!.url).toBe("/api/tasks/task-1/hook");
    // Verbatim: the daemon sees exactly what the agent wrote, with the task id
    // riding in the path rather than wrapped around the payload.
    expect(daemon.received[0]!.body).toBe(payload);
  });

  // SessionStart stdout is injected into the conversation as context, so this
  // is the criterion the whole design of the command hangs on.
  test("writes nothing to stdout, whatever happens", async () => {
    const daemon = fakeDaemon(() => new Response("a reply nobody asked for", { status: 500 }));

    const cases = await Promise.all([
      runHook("{}", { CODETOASTER_TASK_ID: "t", CODETOASTER_PORT: daemon.port }),
      runHook("{}", { CODETOASTER_TASK_ID: "t", CODETOASTER_PORT: deadPort() }),
      runHook("{}", {}),
      runHook("not json at all", { CODETOASTER_TASK_ID: "t", CODETOASTER_PORT: daemon.port }),
      runHook("", { CODETOASTER_TASK_ID: "t", CODETOASTER_PORT: daemon.port }),
    ]);

    for (const run of cases) {
      expect(run.stdout).toBe("");
      expect(run.exitCode).toBe(0);
    }
  });

  test("exits 0 when the daemon is not there at all", async () => {
    const run = await runHook("{}", {
      CODETOASTER_TASK_ID: "task-1",
      CODETOASTER_PORT: deadPort(),
    });

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe("");
  });

  test("gives up on a daemon that never answers", async () => {
    // Accepts the request and then holds it open forever.
    const daemon = fakeDaemon(() => new Promise<Response>(() => {}));

    const run = await runHook("{}", {
      CODETOASTER_TASK_ID: "task-1",
      CODETOASTER_PORT: daemon.port,
    });

    expect(run.exitCode).toBe(0);
    expect(run.ms).toBeLessThan(3000);
  });

  // A hook whose stdin is never closed must not hold the agent until the
  // settings-level timeout kills it.
  test("gives up on a stdin that never closes", async () => {
    const daemon = fakeDaemon();

    const run = await runHook("never-closes", {
      CODETOASTER_TASK_ID: "task-1",
      CODETOASTER_PORT: daemon.port,
    });

    expect(run.exitCode).toBe(0);
    expect(run.ms).toBeLessThan(3000);
    expect(daemon.received).toHaveLength(0);
  });

  test("reports nothing when the environment does not name a task", async () => {
    const daemon = fakeDaemon();

    const missingId = await runHook("{}", { CODETOASTER_PORT: daemon.port });
    const missingPort = await runHook("{}", { CODETOASTER_TASK_ID: "task-1" });

    expect(missingId.exitCode).toBe(0);
    expect(missingPort.exitCode).toBe(0);
    expect(daemon.received).toHaveLength(0);
  });

  test("passes a payload it cannot parse through rather than dropping it", async () => {
    const daemon = fakeDaemon();

    const run = await runHook("this is not json", {
      CODETOASTER_TASK_ID: "task-1",
      CODETOASTER_PORT: daemon.port,
    });

    expect(run.exitCode).toBe(0);
    expect(daemon.received[0]!.body).toBe("this is not json");
  });

  test("posts nothing for an empty payload", async () => {
    const daemon = fakeDaemon();

    const run = await runHook("", {
      CODETOASTER_TASK_ID: "task-1",
      CODETOASTER_PORT: daemon.port,
    });

    expect(run.exitCode).toBe(0);
    expect(daemon.received).toHaveLength(0);
  });
});
