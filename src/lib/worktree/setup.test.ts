import { test, expect, describe, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { readSetupOutcome, wrapWithSetup } from "./setup";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-setup-"));
  tempDirs.push(dir);
  return dir;
}

/** Runs a wrapped command for real. The wrapper's whole job is what a shell
 * does with it, so asserting on the argv alone would test the string and not
 * the behaviour. */
async function run(command: string[], cwd: string) {
  const proc = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

/** Stands in for the agent: prints its argv, one entry per line, so a test can
 * see exactly what survived the wrapper. */
function echoArgv(dir: string): string {
  const bin = path.join(dir, "echo-argv");
  fs.writeFileSync(bin, `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done\n`);
  fs.chmodSync(bin, 0o755);
  return bin;
}

describe("wrapWithSetup", () => {
  test("hands the command back untouched when there is nothing to run", () => {
    const command = ["claude", "--session-id", "abc"];

    expect(wrapWithSetup(command, null, "/tmp/stamp")).toBe(command);
    expect(wrapWithSetup(command, "   ", "/tmp/stamp")).toBe(command);
  });

  test("runs setup first, then execs the agent", async () => {
    const dir = scratch();
    const stamp = path.join(dir, "nested", "setup.exit");

    const result = await run(
      wrapWithSetup([echoArgv(dir), "started"], "echo installing", stamp),
      dir,
    );

    expect(result.exitCode).toBe(0);
    // Setup's output comes first and in the same stream, which is the point:
    // it lands in the agent tab rather than in a log nobody opens.
    expect(result.stdout).toBe("installing\nstarted\n");
    // The stamp's directory did not exist; the wrapper made it.
    expect(fs.readFileSync(stamp, "utf8")).toBe("0");
  });

  // The reason the agent argv travels as `"$@"` rather than being reassembled
  // into a command line. A prompt is arbitrary text — quotes, newlines, `$`,
  // a leading dash — and `buildAgentCommand` puts it in argv precisely so none
  // of that has to be escaped. A wrapper that flattened it would undo that.
  test("passes the agent's argv through byte for byte", async () => {
    const dir = scratch();
    const prompt = `it's "tricky"\n$HOME  --not-a-flag\t\\`;

    const result = await run(
      wrapWithSetup([echoArgv(dir), "--", prompt], "true", path.join(dir, "setup.exit")),
      dir,
    );

    expect(result.stdout).toBe(`--\n${prompt}\n`);
  });

  // `setup_command` is a shell line the user wrote, not a program and its
  // arguments, so the `&&` they typed has to keep working.
  test("runs the setup string with shell semantics", async () => {
    const dir = scratch();

    const result = await run(
      wrapWithSetup([echoArgv(dir), "ok"], "echo one && echo two", path.join(dir, "setup.exit")),
      dir,
    );

    expect(result.stdout).toBe("one\ntwo\nok\n");
  });

  test("a setup command the user quoted awkwardly is still just a string", async () => {
    const dir = scratch();

    const result = await run(
      wrapWithSetup([echoArgv(dir), "ok"], `printf '%s\\n' "a 'b' \\"c\\""`, path.join(dir, "setup.exit")),
      dir,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`a 'b' "c"\nok\n`);
  });

  test("a failing setup stops there, and says so where the user is looking", async () => {
    const dir = scratch();
    const stamp = path.join(dir, "setup.exit");

    const result = await run(
      wrapWithSetup([echoArgv(dir), "should-not-run"], "echo trying; (exit 3)", stamp),
      dir,
    );

    expect(result.exitCode).toBe(3);
    // The agent never started: exec is behind the check, so there is no half-
    // configured session to resume later.
    expect(result.stdout).toBe("trying\n");
    expect(result.stderr).toContain("codetoaster: setup command failed (exit 3)");
    // Recorded anyway. A failed setup is a fact worth keeping — it is the
    // reason the task has no agent.
    expect(fs.readFileSync(stamp, "utf8")).toBe("3");
  });

  // The stamp lives outside the checkout, so a resume or a restore of the same
  // task finds the previous run's file already sitting there. Left alone, a
  // caller asking "has setup finished, and did it fail?" during a 90-second
  // reinstall would be handed last time's exit code as though it were this
  // one's — including a stale failure for a run that is going fine.
  test("clears a previous run's stamp before setup, not after", async () => {
    const dir = scratch();
    const stamp = path.join(dir, "setup.exit");
    fs.writeFileSync(stamp, "7");

    // `$stamp` is the wrapper's own shell variable, and setup is eval'd in
    // that same shell — so the setup line can report what it sees, which is
    // the only way to observe the window rather than its outcome.
    const result = await run(
      wrapWithSetup([echoArgv(dir), "done"],
        'if [ -e "$stamp" ]; then echo STALE; else echo CLEARED; fi', stamp),
      dir,
    );

    expect(result.stdout).toBe("CLEARED\ndone\n");
    expect(fs.readFileSync(stamp, "utf8")).toBe("0");
  });

  // Setup runs in the agent's own shell rather than a subshell, which is what
  // `<setup> && exec "$@"` means and is worth having: a setup command can
  // export environment — a virtualenv activation, a version manager — and the
  // agent inherits it. The cost is that `exit` in a setup command is a real
  // exit, taking the wrapper with it before the stamp is written. That reads
  // correctly downstream: the exit code still reaches the tab, the agent still
  // does not start, and `readSetupOutcome` answering "nothing recorded" is the
  // truth, because setup did not finish — it aborted.
  test("setup runs in the agent's own shell, so its environment carries over", async () => {
    const dir = scratch();

    const exported = await run(
      // Read out of the *environment* by the process that gets exec'd, not
      // expanded out of argv: argv is passed through literally, as the test
      // above pins, so a `$VAR` written there stays four characters.
      wrapWithSetup(["sh", "-c", 'printf "%s\n" "$CT_FROM_SETUP"'],
        "export CT_FROM_SETUP=carried", path.join(dir, "s")),
      dir,
    );
    expect(exported.stdout).toBe("carried\n");

    const stamp = path.join(dir, "aborted.exit");
    const aborted = await run(
      wrapWithSetup([echoArgv(dir), "should-not-run"], "echo giving up; exit 4", stamp),
      dir,
    );
    expect(aborted.exitCode).toBe(4);
    expect(aborted.stdout).toBe("giving up\n");
    expect(fs.existsSync(stamp)).toBe(false);
    expect(await readSetupOutcome(stamp, Date.now())).toBeUndefined();
  });
});

describe("readSetupOutcome", () => {
  test("reports the exit code and how long the checkout took to become usable", async () => {
    const dir = scratch();
    const stamp = path.join(dir, "setup.exit");
    const spawnedAt = Date.now();
    fs.writeFileSync(stamp, "0");

    const outcome = (await readSetupOutcome(stamp, spawnedAt))!;

    expect(outcome.exitCode).toBe(0);
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
    expect(outcome.durationMs).toBeLessThan(60_000);
  });

  test("a duration is measured from the spawn to the stamp", async () => {
    const dir = scratch();
    const stamp = path.join(dir, "setup.exit");
    fs.writeFileSync(stamp, "0");
    const when = new Date(Date.now());
    fs.utimesSync(stamp, when, when);

    const outcome = (await readSetupOutcome(stamp, when.getTime() - 5_000))!;

    expect(outcome.durationMs).toBeGreaterThanOrEqual(4_900);
  });

  // Not a negative duration — a stamp left by this task's previous run, which
  // the current spawn has not reached yet.
  test("a stamp older than the spawn reads as zero, not as time travel", async () => {
    const dir = scratch();
    const stamp = path.join(dir, "setup.exit");
    fs.writeFileSync(stamp, "0");
    const old = new Date(Date.now() - 86_400_000);
    fs.utimesSync(stamp, old, old);

    expect((await readSetupOutcome(stamp, Date.now()))!.durationMs).toBe(0);
  });

  test("nothing recorded is an answer, not a failure", async () => {
    const dir = scratch();
    // No setup_command configured, or the task killed mid-install, or the
    // worktree evicted along with the stamp. None of those are worth throwing.
    expect(await readSetupOutcome(path.join(dir, "never-written"), Date.now())).toBeUndefined();
    const garbage = path.join(dir, "garbage");
    fs.writeFileSync(garbage, "not a number");
    expect(await readSetupOutcome(garbage, Date.now())).toBeUndefined();
  });
});
