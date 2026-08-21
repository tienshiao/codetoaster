import { test, expect, describe, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { gitSpawn } from "./utils";

// Exercising the timeout needs a git that really hangs, because the thing being
// verified is that the child dies — a stubbed promise cannot show that.
//
// The shim has to be on the PATH the *spawning process started with*: Bun.spawn
// resolves the executable from the environment captured at startup, so mutating
// process.env.PATH inside this test would still find the real git. Hence a child
// bun process with a doctored PATH, which then calls the real gitSpawn.
// A fractional duration unique to this run, so the orphan check below cannot
// be tripped by an unrelated `sleep` that happens to be running on the machine.
const HANG_DURATION = `30.${process.pid}`;

function makeShimDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-git-shim-"));
  const shim = path.join(dir, "git");
  fs.writeFileSync(shim, `#!/bin/sh\nexec sleep ${HANG_DURATION}\n`);
  fs.chmodSync(shim, 0o755);
  return dir;
}

let shimDir: string | null = null;
afterEach(() => {
  if (shimDir) fs.rmSync(shimDir, { recursive: true, force: true });
  shimDir = null;
});

describe("gitSpawn", () => {
  test("kills a git that outlives its timeout, rather than abandoning it", () => {
    shimDir = makeShimDir();
    const script = `
      import { gitSpawn } from ${JSON.stringify(path.join(import.meta.dir, "utils.ts"))};
      const started = Date.now();
      const { exitCode } = await gitSpawn(process.cwd(), ["rev-parse", "HEAD"], { timeoutMs: 150 });
      console.log(JSON.stringify({ elapsed: Date.now() - started, exitCode }));
    `;
    const proc = Bun.spawnSync(["bun", "-e", script], {
      env: { ...process.env, PATH: `${shimDir}:${process.env.PATH}` },
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = new TextDecoder().decode(proc.stdout).trim();
    expect(out).not.toBe("");
    const { elapsed, exitCode } = JSON.parse(out.split("\n").at(-1)!);

    // Returned on the timeout, not after the shim's sleep.
    expect(elapsed).toBeLessThan(30_000);
    // 143 = 128 + SIGTERM, so callers' `exitCode !== 0` check treats a timeout
    // as a failed lookup with no special casing.
    expect(exitCode).not.toBe(0);

    // And the child is actually gone rather than orphaned — the bug this option
    // exists to prevent. pgrep matches the full command line, finding the
    // `sleep` the shim exec'd into.
    const pgrep = Bun.spawnSync(["pgrep", "-f", `^sleep ${HANG_DURATION}$`], { stdout: "pipe" });
    expect(new TextDecoder().decode(pgrep.stdout).trim()).toBe("");
  });

  test("leaves a command that finishes inside its budget alone", async () => {
    const { stdout, exitCode } = await gitSpawn(process.cwd(), ["rev-parse", "--abbrev-ref", "HEAD"], {
      timeoutMs: 10_000,
    });
    expect(exitCode).toBe(0);
    expect(stdout.trim().length).toBeGreaterThan(0);
  });

  test("runs without a timeout when none is given", async () => {
    const { exitCode } = await gitSpawn(process.cwd(), ["rev-parse", "--abbrev-ref", "HEAD"]);
    expect(exitCode).toBe(0);
  });
});
