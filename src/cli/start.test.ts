import { test, expect, describe, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const CLI = path.join(import.meta.dir, "..", "index.ts");

interface Run {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  home: string;
}

const started: number[] = [];
const homes: string[] = [];
afterEach(() => {
  // Swept from the pid files as well as from what a test remembered to record:
  // a failing expectation aborts the test body where it stands, and one that
  // lands before the pid is noted would otherwise leave a real daemon
  // listening on this machine for the rest of the day.
  for (const home of homes) {
    for (const file of pidFiles(home)) {
      try {
        const info = JSON.parse(fs.readFileSync(path.join(home, ".codetoaster", file), "utf-8"));
        if (typeof info?.pid === "number") started.push(info.pid);
      } catch {}
    }
  }
  for (const pid of started.splice(0)) {
    try { process.kill(pid); } catch {}
  }
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
});

/** `start` as its own process, with a HOME of its own so the pid files it
 * writes — the thing under test — land somewhere disposable rather than in the
 * user's real ~/.codetoaster. The daemon it spawns inherits the env, so it
 * writes there too. */
async function runStart(args: string[], env: Record<string, string> = {}): Promise<Run> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-start-"));
  homes.push(home);
  // No subcommand: starting the daemon is what a bare `codetoaster` does.
  const proc = Bun.spawn([process.execPath, CLI, "--db", path.join(home, "test.db"), ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HOME: home, ...env },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode, home };
}

/** The server in the foreground, read until it says the thing under test.
 *
 * Foreground rather than `start` because the line being checked is written by
 * the server on its way up, and `start`'s child sends its stdout to the log
 * file — this way the assertion is on the process the test is holding rather
 * than on a file it would have to poll. The child is killed here as well as in
 * `afterEach`, so a passing test leaves nothing running for the length of the
 * suite.
 */
async function runForeground(args: string[], expected: RegExp, env: Record<string, string> = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-fg-"));
  homes.push(home);
  const proc = Bun.spawn(
    [process.execPath, CLI, "foreground", "--db", path.join(home, "test.db"), "--port", "0", ...args],
    {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, HOME: home, ...env },
    },
  );
  // Recorded before the first read: an assertion that throws below must still
  // leave the sweep something to kill.
  started.push(proc.pid);

  const decoder = new TextDecoder();
  const reader = proc.stdout.getReader();
  let seen = "";
  // The server binds, migrates and reconciles before it logs anything, and a
  // loaded CI machine is slower at all three than a laptop.
  const deadline = Date.now() + 15_000;
  try {
    while (!expected.test(seen)) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${expected}; saw:\n${seen}`);
      const chunk = await Promise.race([
        reader.read(),
        Bun.sleep(deadline - Date.now()).then(() => ({ done: true, value: undefined }) as const),
      ]);
      if (chunk.done) throw new Error(`stdout ended before ${expected}; saw:\n${seen}`);
      seen += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    reader.cancel().catch(() => {});
    try { proc.kill(); } catch {}
    await proc.exited;
  }
  return seen;
}

function pidFiles(home: string): string[] {
  const dir = path.join(home, ".codetoaster");
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".pid")) : [];
}

describe("starting the daemon", () => {
  test("--port 0 reports the port the kernel actually gave it", async () => {
    const run = await runStart(["--port", "0"]);

    expect(run.exitCode).toBe(0);
    // The whole bug: the daemon binds an ephemeral port and writes its pid file
    // there, while the CLI polled the number it asked for. It reported a
    // healthy daemon as dead and left it running.
    const reported = run.stdout.match(/Started \(pid (\d+), port (\d+)\)/);
    expect(reported).not.toBeNull();
    const [, pid, port] = reported!;
    started.push(Number(pid));
    expect(Number(port)).toBeGreaterThan(0);

    // Named, and actually there.
    expect(run.stdout).toContain(`Web UI: http://localhost:${port}`);
    expect((await fetch(`http://localhost:${port}/api/ping`)).ok).toBe(true);
    expect(pidFiles(run.home)).toEqual([`codetoaster.${port}.pid`]);
  }, 20000);

  test("a daemon that cannot come up is not left behind", async () => {
    // An address this machine does not have: the daemon throws on bind and
    // exits. Nothing should survive it — not the process, not a pid file — and
    // the CLI should not spend all fifteen attempts waiting for a process it
    // can see is gone.
    const run = await runStart(["--port", "0", "--host", "203.0.113.1"]);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("not responding");
    expect(run.stdout).not.toContain("Started");
    expect(pidFiles(run.home)).toEqual([]);
  }, 20000);
});

// End to end on purpose: the flag has to survive `parseArgs`, `resolveDuration`,
// the options object, `startServer` and the two setters, and the log line is the
// only place from outside where all five can be checked at once.
describe("configuring the harvester", () => {
  test("both windows come from the flags", async () => {
    const out = await runForeground(
      ["--harvest-after", "2h", "--evict-after", "0"],
      /Harvest after .*\n/,
    );
    // `0` reads as the tier being off rather than as a zero-length window.
    expect(out).toContain("Harvest after 2h, evict after disabled");
  }, 30000);

  test("the environment is honoured with no flag", async () => {
    const out = await runForeground([], /Harvest after .*\n/, {
      CODETOASTER_HARVEST_AFTER: "45m",
    });
    // The other tier was not configured, so it reports its own default.
    expect(out).toContain("Harvest after 45m, evict after 7d");
  }, 30000);

  test("the flag beats the environment", async () => {
    const out = await runForeground(["--harvest-after", "2h"], /Harvest after .*\n/, {
      CODETOASTER_HARVEST_AFTER: "1h",
    });
    expect(out).toContain("Harvest after 2h");
  }, 30000);

  test("a bad flag is refused before any daemon is spawned", async () => {
    const run = await runStart(["--port", "0", "--harvest-after", "90s"]);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("--harvest-after");
    expect(run.stderr).toContain("expected a duration like 30m, 2h or 7d, or 0 to disable");
    // The point of validating before the switch: a detached child would have
    // failed the same way into a log file, and the user would have seen only
    // "not responding".
    expect(pidFiles(run.home)).toEqual([]);
  }, 20000);

  test("a bad environment value names the variable", async () => {
    const run = await runStart(["--port", "0"], { CODETOASTER_EVICT_AFTER: "forever" });

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("CODETOASTER_EVICT_AFTER");
    expect(pidFiles(run.home)).toEqual([]);
  }, 20000);
});
