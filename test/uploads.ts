import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/** A throwaway staging root, made once per process and reused. */
let root: string | undefined;

/**
 * Point `CODETOASTER_UPLOADS_DIR` somewhere disposable.
 *
 * Called from the runners' entry points and from a `beforeEach` covering every
 * test, exactly as `useFakeAgentBin` and `useTestShell` are — and for a sharper
 * reason than either: the uploads tier *deletes*. `collectUploads` takes any
 * staging directory older than its window that no prompt in the database names,
 * and a test's in-memory database names none of the developer's. So a
 * `new Harvester(manager)` anywhere — the default construction, which several
 * files use deliberately to assert the shipped defaults — would reach into the
 * real `~/.codetoaster/uploads` and take the attachments of the user's actual
 * tasks. Switching the tier off per call site is what that would otherwise
 * need, and is exactly the kind of thing a new file does not know to do.
 *
 * Unconditional and repeated per test, for the reason `test/agent-bin.ts`
 * records: a file that points the variable somewhere of its own and does not
 * put it back would otherwise leave that standing for everything after it.
 */
export function useTestUploadsDir(): void {
  root ??= fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-test-uploads-"));
  process.env.CODETOASTER_UPLOADS_DIR = root;
}
