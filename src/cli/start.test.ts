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
  for (const pid of started.splice(0)) {
    try { process.kill(pid); } catch {}
  }
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
});

/** `start` as its own process, with a HOME of its own so the pid files it
 * writes — the thing under test — land somewhere disposable rather than in the
 * user's real ~/.codetoaster. The daemon it spawns inherits the env, so it
 * writes there too. */
async function runStart(args: string[]): Promise<Run> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-start-"));
  homes.push(home);
  // No subcommand: starting the daemon is what a bare `codetoaster` does.
  const proc = Bun.spawn([process.execPath, CLI, "--db", path.join(home, "test.db"), ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HOME: home },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode, home };
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
