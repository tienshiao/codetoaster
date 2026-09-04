import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "node:url";

/** The shell every test spawns, as an absolute path.
 *
 * Pinned, and not `process.env.SHELL`, because a test that spawns the
 * developer's login shell is a test whose result depends on whose machine it
 * ran on. Fish is the case that proved it: on startup it writes terminal
 * queries — the kitty-keyboard probe, `XTVERSION`, an OSC 11 background-colour
 * request, two `XTGETTCAP`s, and finally a Primary DA (`\x1b[0c`) — and then
 * waits for the answers before it will draw a prompt or run a line. Until
 * TASK-83 the server's headless terminal answered none of them, so under a
 * fish `$SHELL` the shell never reached its prompt, every `waitFor` on a title
 * or an exit burned its full deadline, and seven tests failed on a machine
 * where nothing was wrong with the code. bash and zsh query nothing and print
 * a prompt immediately, which is the only reason this was ever green anywhere.
 * The DA is answered now and fish starts, but the pin stays: a login shell is
 * still whatever the developer's config makes it — its prompt, its greeting,
 * its `exec` into something else — and none of that belongs in a test's
 * scrollback.
 *
 * bash rather than `/bin/sh`: `/bin/sh` is dash on most Linux CI images, whose
 * `printf` does not read `\033`, and the title tests are written in exactly
 * that escape. bash is on macOS and Linux both, and was already what these
 * files fell back to.
 *
 * A wrapper script rather than `/bin/bash` itself, because pinning the binary
 * is only half the pin: bash on a PTY with no operands is *interactive* and
 * sources `~/.bashrc`, which is the developer's machine again. `test-shell.sh`
 * strips that off with `--norc --noprofile` and finds bash on PATH, which the
 * absolute-path requirement (`openShell` spawns `$SHELL` as-is) otherwise
 * rules out. Its header has the rest.
 *
 * Resolved through `import.meta.url` and not Bun's `import.meta.dir`, for the
 * reason `agent-bin.ts` records: this module is loaded by both runners and Vite
 * leaves `dir` undefined, which would fail at import time and take every
 * rendering file down with it.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TEST_SHELL = path.join(HERE, "test-shell.sh");

/**
 * Pin `SHELL` for the process, so anything spawning a shell gets a predictable
 * one.
 *
 * Called from both runners' entry points and from a `beforeEach` covering every
 * test, exactly as `useFakeAgentBin` is and for the same reason: the tests that
 * need this most reach a shell through *production* code — `TaskManager.openShell`
 * spawns `process.env.SHELL || "/bin/sh"` and takes no override — so pinning
 * only the test helpers would leave the shell-tab and harvester tests still
 * running whatever the developer happens to log in with.
 *
 * Unconditional and repeated per test for the reason `test/agent-bin.ts`
 * records: filling the variable only when empty holds until the first file that
 * sets its own and does not put it back.
 */
export function useTestShell(): void {
  process.env.SHELL = TEST_SHELL;
  // macOS's bash 3.2 greets an interactive session with the "default
  // interactive shell is now zsh" notice, which lands in the terminal buffer
  // and is then in the scrollback of every test that reads one. Emitted by
  // bash itself, so `--norc` does not cover it.
  process.env.BASH_SILENCE_DEPRECATION_WARNING = "1";
  // The exec bit is committed, but it is one `git config core.fileMode false`
  // or one zip round trip away from being gone — and the symptom then is a
  // spawn failure in whichever file happens to run first rather than anything
  // naming this one. Same guard, and same reasoning, as `useFakeAgentBin`.
  try {
    fs.chmodSync(TEST_SHELL, 0o755);
  } catch {
    // A read-only checkout: if the bit is already right this changes nothing,
    // and if it is wrong `test-shell.test.ts` says so in terms a reader can
    // act on.
  }
}
