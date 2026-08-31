import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "node:url";

/** The stand-in agent (`fake-agent.sh`), as an absolute path.
 *
 * Resolved through `import.meta.url` and not Bun's `import.meta.dir`: this
 * module is loaded by both runners, and Vite leaves `dir` undefined — which
 * fails at import time and takes every rendering file down with it, naming
 * this line rather than anything a reader would connect to an agent. The same
 * `fileURLToPath` idiom `vitest.config.ts` uses for its alias. */
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FAKE_AGENT_BIN = path.join(HERE, "fake-agent.sh");

/**
 * Point `CODETOASTER_AGENT_BIN` at the stand-in.
 *
 * Called from both runners' entry points, and from a `beforeEach` that covers
 * every test — so neither runner can spawn a real agent, and a test file added
 * tomorrow inherits that without knowing this exists.
 *
 * Unconditional, which is the part that took a bug to get right. Filling the
 * variable only when it is empty looks more polite and does not hold: a file
 * that points it at a stand-in of its own and never puts it back leaves that
 * value standing for every file that runs afterwards, and a file that
 * `delete`s it in an `afterEach` leaves the next one with nothing. Both
 * happened here. Assigning every time makes "each test starts from a harmless
 * agent" true by construction rather than by everyone remembering.
 *
 * A file that wants a different agent — one that records its argv, one that
 * fails a resume rung, one that is not there at all — still sets the variable
 * from its own `beforeEach` or its test body, both of which run after this.
 * The one thing that no longer works is setting it in a `beforeAll`.
 */
export function useFakeAgentBin(): void {
  process.env.CODETOASTER_AGENT_BIN = FAKE_AGENT_BIN;
  // The exec bit is committed, but it is one `git config core.fileMode false`
  // or one zip round trip away from being gone, and the symptom then is a
  // spawn failure in whichever test file happens to run first rather than
  // anything naming this file. Cheaper to assert it than to explain it.
  try {
    fs.chmodSync(FAKE_AGENT_BIN, 0o755);
  } catch {
    // A read-only checkout: if the bit is already right this changes nothing,
    // and if it is wrong the guard test says so in terms a reader can act on.
  }
}
