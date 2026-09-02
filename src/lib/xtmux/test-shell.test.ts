import { test, expect, describe } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { TEST_SHELL } from "../../../test/shell";

/**
 * The guard on the shell pin, and a sibling of `agent-bin.test.ts`.
 *
 * `test/preload.ts` pins `SHELL` for the whole run so that no test spawns the
 * developer's login shell. Like the agent pin, the mechanism is a line in
 * `bunfig.toml`, and CLAUDE.md records that bunfig's test options are honoured
 * from a shell and silently ignored under `bun run` — so it can stop working
 * with nothing failing anywhere near it.
 *
 * What it fails as, when it lapses, is worth writing down: a machine whose
 * `$SHELL` is fish loses seven tests across three files, all of them on a
 * `waitFor` deadline rather than an assertion, and none of them naming a shell.
 * Fish opens by querying the terminal — kitty keyboard, `XTVERSION`, OSC 11,
 * `XTGETTCAP`, Primary DA — and waits for answers the headless terminal never
 * sends, so it never draws a prompt or runs a line. This is what says so
 * instead.
 */
describe("no test spawns the developer's login shell", () => {
  test("the pin is what the environment names", () => {
    expect(process.env.SHELL).toBe(TEST_SHELL);
  });

  test("and it is a real, executable shell", () => {
    expect(fs.statSync(TEST_SHELL).isFile()).toBe(true);
    fs.accessSync(TEST_SHELL, fs.constants.X_OK);
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

  test("and the shell it names does not read the developer's rc files", () => {
    // The other half of the pin, and the half that is easy to lose: bash on a
    // PTY with no operands is interactive, so it sources `~/.bashrc` unless
    // told not to. Ubuntu's stock one writes an OSC 0 title from `PS1`
    // whenever `TERM` matches `xterm*` — which `pty.ts` forces — and that
    // races the title the tests in `manager.test.ts` write; one ending in
    // `exec fish` restores the original failure outright.
    expect(fs.readFileSync(TEST_SHELL, "utf8")).toContain("--norc");
  });
});
