import * as fs from "fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

/** Where a file handed to the daemon by a browser lands.
 *
 * Beside the database rather than in `/tmp`, which is where the task-scoped
 * upload used to write: an attachment is named in a prompt the agent may not
 * read for a while, and macOS sweeps `/tmp` out from under it. Beside the
 * *database*, not under a fixed `~/.codetoaster/`, because this module
 * *deletes*: `collectUploads` weighs a staging directory against the prompts
 * of whatever database the daemon holds, so two daemons over one staging root
 * and two databases (`--db`, which `codetoaster instances` supports side by
 * side) would each read the other's attachments as unreferenced and remove
 * them. Rooting the directory on the database keeps the writer and the
 * collector over the same rows by construction; the default database at
 * `~/.codetoaster/data.db` lands it at `~/.codetoaster/uploads`, next to the
 * tasks directory that keeps per-task files for the same durability reason.
 *
 * `CODETOASTER_UPLOADS_DIR` overrides both, and exists for the same hazard one
 * level down: every `bun test` that builds a `Harvester` on its defaults holds
 * an in-memory database naming none of the developer's real attachments.
 * `test/uploads.ts` points the variable at a temporary root before every test,
 * the way `test/agent-bin.ts` pins the agent, so the safety is by construction
 * rather than by each call site remembering. */
export function uploadsDir(dbPath?: string): string {
  if (process.env.CODETOASTER_UPLOADS_DIR) return process.env.CODETOASTER_UPLOADS_DIR;
  return join(dbPath ? dirname(dbPath) : join(homedir(), ".codetoaster"), "uploads");
}

/**
 * Multipart files to disk, answering with the absolute path of each.
 *
 * One directory per call, named by a fresh uuid, so a file keeps the name the
 * user gave it — which is the half of the path the agent shows back to them,
 * and a uuid smeared into the filename makes an attachment unreadable in the
 * prompt it is named in. Collisions between two calls are a directory apart.
 *
 * Two files of the same name in *one* call are not: attaching `image.png` from
 * two different folders is an ordinary thing to do, and writing both to one
 * path would hand the agent the same file twice while the composer showed two
 * chips — a lost attachment with nothing anywhere saying so. So the second gets
 * a counter before its extension, the way a download folder does it, and the
 * path answered is the one actually written. Collisions are judged
 * case-insensitively, because the filesystem this runs on (APFS as macOS ships
 * it) is: `Shot.png` and `shot.png` are one file there, and a set that told
 * them apart would let the second overwrite the first with two paths answered.
 *
 * The uuid is also what makes the directory collectable: `collectUploads`
 * removes only names of that shape, so nothing a user happens to have put in
 * this directory by hand is ever in scope.
 *
 * `basename`, because the name comes off a multipart body and a client is free
 * to send `../../.zshrc`: `Bun.write` would resolve that out of the staging
 * directory and overwrite the file it names. A name that basenames to nothing
 * — `..`, `/`, empty — gets a stand-in rather than being refused, since it is
 * a file the user really did attach and the name is the only thing wrong with
 * it.
 *
 * `root` is the daemon's `uploadsDir(dbPath)`, threaded from `startServer` so
 * the writer and the collector agree on it; the default is for a caller that
 * has no database to speak of, which is a test.
 */
export async function saveUploads(files: File[], root: string = uploadsDir()): Promise<string[]> {
  const dir = join(root, crypto.randomUUID());
  // Names first, in order, because the counter depends on what came before;
  // then every write at once, because nothing else does.
  const taken = new Set<string>();
  const paths = files.map((file) => {
    const name = basename(file.name);
    const safe = name && name !== "." && name !== ".." ? name : "attachment";
    const unique = uniqueName(safe, taken);
    taken.add(unique.toLowerCase());
    return join(dir, unique);
  });
  await Promise.all(paths.map((path, i) => Bun.write(path, files[i]!)));
  return paths;
}

/** `shot.png`, then `shot-2.png`, then `shot-3.png`. Before the extension, so
 * the suffix does not change what kind of file the name says it is — an agent
 * deciding whether to read a path as an image reads the end of it. `taken`
 * holds lower-cased names, and is asked lower-cased, for the filesystem's
 * reason above. */
function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name.toLowerCase())) return name;
  // Only a real extension: a leading dot is the whole name of a dotfile, not a
  // separator, so `.zshrc` numbers as `.zshrc-2` rather than `-2.zshrc`.
  const dot = name.lastIndexOf(".");
  const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${extension}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * Staged paths as one line to type into a PTY.
 *
 * Space-separated is what the reader on the other end — a shell, or Claude
 * Code's prompt — reads as a list, and it is also what makes an unquoted path
 * with a space in it two entries instead of one. That is not an exotic case:
 * the file this feature exists for is `Screenshot 2026-09-06 at 14.22.13.png`,
 * and joining it raw hands the agent five fragments, none of which is a file.
 *
 * Quoted only when the path holds something a word split would act on, so the
 * ordinary case stays a bare readable path — the whole point of keeping the
 * user's filename in `saveUploads`. Single quotes, with the one escape they
 * need, because nothing inside them is expanded.
 */
export function ptyPathList(paths: string[]): string {
  return paths
    .map((path) =>
      /^[\w@%+=:,./-]+$/.test(path) ? path : `'${path.replaceAll("'", `'\\''`)}'`,
    )
    .join(" ");
}

/** What `saveUploads` names a directory, and therefore the only shape this
 * module will ever delete. Anything else directly under the staging root was
 * put there by somebody other than us, and is none of our business. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CollectUploadsOptions {
  /** Defaults to `uploadsDir()`. Passed by the harvester so a test never
   * collects against the developer's own home. */
  root?: string;
  /** How old a directory has to be before it is even considered. */
  olderThanMs: number;
  now: number;
  /** Every prompt that could name an attachment, read *lazily* — see below. */
  prompts: () => string[];
}

/**
 * Give back the staging directories nothing is using any more (TASK-94).
 *
 * Two conditions, and both are load-bearing.
 *
 * **Named by no prompt.** A composer attachment's path lives inside
 * `initial_prompt`, and a suspended conversation can be resumed and re-read
 * days later, so a file a prompt still names is not ours to delete however old
 * it is. That is what couples an attachment's lifetime to its task's without
 * any back-link existing between them: the reference *is* the link, and a task
 * that is hard-deleted takes its prompt — and so its attachments — with it.
 *
 * **Old enough.** Two different things need this. A directory written moments
 * ago is named by nothing yet, because the `POST /api/tasks` that will name it
 * is still in flight; without the age guard the sweep would race the create it
 * is waiting on. And the task-scoped upload — a file dropped on a live
 * terminal — writes its paths into the *PTY*, so no row will ever name it and
 * age is the only thing that can ever collect it. A drop older than the window
 * whose agent wants to re-read it is the accepted loss, which is the same
 * bargain the evict tier strikes with a checkout.
 *
 * `prompts` is a thunk rather than an array because the common tick has
 * nothing to collect: reading the directory is one syscall, and the table scan
 * behind the prompts is only paid when something has actually aged out.
 *
 * Best-effort throughout, like `removeTaskDir`. A staging root that does not
 * exist is the state being asked for — nothing has ever been uploaded — and a
 * directory that cannot be read or removed must not be able to fail the sweep
 * for the ones after it.
 */
export async function collectUploads(options: CollectUploadsOptions): Promise<string[]> {
  const root = options.root ?? uploadsDir();
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const cutoff = options.now - options.olderThanMs;
  const candidates: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !UUID_RE.test(entry.name)) continue;
    const dir = join(root, entry.name);
    try {
      // `mtime` on the directory, which `saveUploads` sets by writing into it
      // and nothing moves afterwards — so it is the moment the attachment was
      // made, which is what the window is about.
      const stat = await fs.promises.stat(dir);
      if (stat.mtimeMs < cutoff) candidates.push(dir);
    } catch {
      // Removed under us, or unreadable. Either way not ours to act on.
    }
  }
  if (candidates.length === 0) return [];

  const prompts = options.prompts();
  const removed: string[] = [];
  for (const dir of candidates) {
    // The whole directory path, not the uuid alone: a substring test against
    // the path that was actually handed out cannot drift from the way those
    // paths are built the way a second regex over the prompt could.
    if (prompts.some((prompt) => prompt.includes(dir))) continue;
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
      removed.push(dir);
    } catch {
      // Next tick will find it again.
    }
  }
  return removed;
}
