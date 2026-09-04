import { test, expect, describe } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Pty } from "./pty";
import { TEST_SHELL } from "../../../test/shell";
import { waitFor } from "../../../test/wait";

/**
 * The guard on the shell pin, and a sibling of `agent-bin.test.ts`.
 *
 * `test/preload.ts` pins `SHELL` for the whole run so that no test spawns the
 * developer's login shell. Like the agent pin, the mechanism is a line in
 * `bunfig.toml`, and CLAUDE.md records that bunfig's test options are honoured
 * from a shell and silently ignored under `bun run` — so it can stop working
 * with nothing failing anywhere near it.
 *
 * What it failed as, when it lapsed, is worth writing down: a machine whose
 * `$SHELL` was fish lost seven tests across three files, all of them on a
 * `waitFor` deadline rather than an assertion, and none of them naming a shell.
 * Fish opens by querying the terminal — kitty keyboard, `XTVERSION`, OSC 11,
 * `XTGETTCAP`, Primary DA — and waits for the answers, which the headless
 * terminal did not send until TASK-83. It answers the DA now, so a lapse would
 * fail more quietly: a developer's real prompt and rc files in the scrollback
 * of whichever test reads one. This is what says so instead.
 */
describe("no test spawns the developer's login shell", () => {
  test("the pin is what the environment names", () => {
    expect(process.env.SHELL).toBe(TEST_SHELL);
  });

  test("and it is a real, executable shell", () => {
    expect(fs.statSync(TEST_SHELL).isFile()).toBe(true);
    fs.accessSync(TEST_SHELL, fs.constants.X_OK);
  });

  test("whose interpreter is on PATH", () => {
    // The wrapper is a `/bin/sh` script that `exec`s `bash` by name, and the
    // images it does that for — stock Alpine, NixOS — are the ones that may
    // have no bash at all. The wrapper's own mode bit says nothing about that;
    // there, `exec` fails with 127 and every test that reaches a shell burns
    // its deadline on a PTY that painted nothing, naming no shell. Running it
    // is the check.
    const ran = Bun.spawnSync([TEST_SHELL, "-c", "printf ok"]);
    expect(ran.exitCode).toBe(0);
    expect(ran.stdout.toString()).toBe("ok");
  });

  test("so openShell's own fallback is never what runs", () => {
    // `TaskManager.openShell` spawns `process.env.SHELL || "/bin/sh"` and takes
    // no override, which is why this is pinned in the environment rather than
    // passed: these are the shell-tab and harvester tests' only protection.
    expect(process.env.SHELL).toBeTruthy();
    // By name, not by one machine's install path: fish is `/opt/homebrew/bin`
    // on a Mac, `/usr/bin` on Debian and `/usr/local/bin` on a build from
    // source, and an equality against any one of those passes everywhere the
    // others are true.
    expect(path.basename(process.env.SHELL!)).not.toBe("fish");
  });

  test("and the shell it names does not read the developer's rc files", async () => {
    // The other half of the pin, and the half that is easy to lose: bash on a
    // PTY with no operands is interactive, so it sources `~/.bashrc` unless
    // told not to. Ubuntu's stock one writes an OSC 0 title from `PS1`
    // whenever `TERM` matches `xterm*` — which `pty.ts` forces — and that
    // races the title the tests in `manager.test.ts` write; one ending in
    // `exec fish` restores the original failure outright.
    //
    // Checked by doing it, not by reading the wrapper for `--norc`: its header
    // comment names the flag too, so a grep stayed green with the flag gone
    // from the `exec` line. A home with an rc file that paints a marker, the
    // wrapper spawned the way `openShell` spawns it — interactive, on a PTY —
    // and a prompt that arrives without the marker is the pin holding.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "test-shell-home-"));
    fs.writeFileSync(path.join(home, ".bashrc"), "printf 'RC_WAS_SOURCED'\n");
    const pty = new Pty("rc", [TEST_SHELL], 80, 24, { env: { HOME: home } });
    try {
      // Interactive bash draws a prompt once it is up; `PS1` is whatever the
      // machine's default is, so wait for anything at all to be painted.
      expect(await waitFor(() => pty.serialize().trim() !== "")).toBe(true);
      expect(pty.serialize()).not.toContain("RC_WAS_SOURCED");
    } finally {
      pty.kill();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
