import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listGitFiles } from "../lib/file-listing";
import { gitSpawn } from "../lib/git/spawn";
import { mapWithConcurrency } from "./utils";

// Diff a single untracked file against /dev/null. `git diff --no-index` exits
// non-zero when files differ, so the exit code is intentionally ignored. `--`
// because the name is whatever the user called the file, and one starting with
// a dash would otherwise be read as an option.
async function diffUntrackedFile(dir: string, file: string): Promise<string> {
  const { stdout } = await gitSpawn(dir, ["diff", "--no-index", "--", "/dev/null", file]);
  return stdout;
}

/** How many of the per-file fallback diffs may run at once. */
export const UNTRACKED_DIFF_CONCURRENCY = 16;

/** The diff of every untracked file against nothing, as `git diff` would show
 * it had each been staged as a new file — a fixed handful of processes for the
 * lot, however many there are (TASK-113).
 *
 * This used to be one `git diff --no-index /dev/null <file>` per untracked
 * file, all spawned at once. A checkout with a build directory that is not
 * ignored has thousands of untracked files, and since the checkout watcher
 * (TASK-103) refetches this diff on every burst of writes, a build in such a
 * checkout had the daemon forking thousands of gits a second for as long as
 * it ran.
 *
 * The trick is the one the WIP snapshot uses: `GIT_INDEX_FILE` pointed at a
 * scratch file. The scratch starts as a copy of the real index, so git knows
 * which files are tracked; `git add -N .` then records every untracked path
 * as intent-to-add without hashing a byte or writing an object; and `git diff
 * --diff-filter=A` over that index shows each one as a new file with its
 * whole content — byte for byte what `--no-index` against `/dev/null`
 * printed, including the binary and "no newline" cases, and in the same
 * order, since the index sorts by path as `ls-files` does. The live index is
 * never opened, so nothing the user has staged is touched and no `index.lock`
 * is taken.
 *
 * Letting git find the files, rather than handing it the listing the route
 * already has, is what makes this safe to run during a build. The listing is
 * out of date the moment it is taken — the reason the diff is being asked for
 * is that files are being written — and `git add` aborts outright on a path
 * that is no longer there. Walking the tree itself, it skips what has gone
 * before it looks, and a file gone between the add and the diff is a
 * deletion, which the filter drops. One window stays: a file that goes
 * between git's directory walk and its stat of that file is a `fatal:
 * unable to stat`, which `--ignore-errors` does not cover. That is a few
 * milliseconds per request, so it is answered by trying the add again on a
 * fresh copy, a few times with a growing pause between, before giving up on
 * the one-shot at all. What else the filter and the flags take care of: a
 * tracked
 * file's own edits and deletions, which are the unstaged diff's business
 * (`--ignore-removal` keeps them in the scratch to be filtered rather than
 * staging them there); and an empty untracked file, which rename detection
 * would otherwise pair with a deleted empty tracked one (`--no-renames`).
 * `core.splitIndex=false` because with the split index on, every write to a
 * fresh index file leaves a `sharedindex.<sha>` in `.git` that only the
 * scratch index references, and git only expires those after a fortnight;
 * refetched once a second through a build, that is thousands of them.
 *
 * Two cases need a hand. A nested repository is listed by `ls-files -o` as
 * `dir/`, and `git add .` either refuses it (no commit checked out; an error
 * `--ignore-errors` steps over, hence exit 1 is accepted) or records it as a
 * gitlink, mode 160000, which no other entry here can be — the per-file diff
 * produced nothing for either, so gitlink sections are dropped. And a path
 * with unmerged entries — a merge the agent is in the middle of — is one
 * `git add .` settles as intent-to-add whatever pathspec is given, which
 * would make a conflicted tracked file appear as a new one; those are settled
 * to an ordinary stage-0 entry in the scratch first, so the add leaves them
 * alone and the filter classifies them as modified.
 *
 * What is left to the per-file diff, through a small pool rather than all at
 * once, is a file git cannot read — permissions, usually — which stops
 * `git diff` partway through with what it had printed so far. That is not an
 * answer, and the per-file diff tolerates it. */
export async function diffUntrackedFiles(dir: string): Promise<string> {
  const diff = await intentToAddDiff(dir);
  if (diff !== null) return diff;
  const paths = (await listGitFiles(dir, { cached: false })).filter((file) => !file.endsWith("/"));
  const diffs = await mapWithConcurrency(paths, UNTRACKED_DIFF_CONCURRENCY, (file) =>
    diffUntrackedFile(dir, file),
  );
  return diffs.join("");
}

const NO_SPLIT_INDEX = ["-c", "core.splitIndex=false"];
/** How many times the intent-to-add is tried before the per-file path, and
 * how long the wait grows between tries: a burst of deletions — a clean
 * rebuild — lasts a few hundred milliseconds, and an attempt made straight
 * away just loses the same race again. */
export const INTENT_TO_ADD_ATTEMPTS = 5;
export const INTENT_TO_ADD_BACKOFF_MS = 100;

/** The one-shot described above, or null when git would not go through with
 * it and the caller has to try something else. */
async function intentToAddDiff(dir: string): Promise<string | null> {
  // `--git-path` rather than `<dir>/.git/index`, because a linked worktree
  // keeps its index under the main repository's `.git/worktrees/<name>/`.
  const [where, unmerged] = await Promise.all([
    gitSpawn(dir, ["rev-parse", "--git-path", "index"]),
    gitSpawn(dir, ["ls-files", "-z", "--unmerged"]),
  ]);
  if (where.exitCode !== 0 || unmerged.exitCode !== 0) return null;
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "codetoaster-diff-"));
  try {
    const index = path.join(scratch, "index");
    const env = { GIT_INDEX_FILE: index };
    const settled = settledStages(unmerged.stdout);
    for (let attempt = 1; ; attempt++) {
      // A fresh copy each time: an add that died wrote nothing, but there is
      // no reason to reason about what it left.
      await fsp.rm(index, { force: true });
      try {
        await fsp.copyFile(path.resolve(dir, where.stdout.trim()), index);
      } catch (error) {
        // A repository with no commit and nothing staged has no index file
        // yet, and an empty scratch is exactly what a copy of it would be.
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null;
      }
      if (settled !== "") {
        const { exitCode } = await gitSpawn(
          dir,
          [...NO_SPLIT_INDEX, "update-index", "-z", "--index-info"],
          { env, stdin: settled },
        );
        if (exitCode !== 0) return null;
      }
      const added = await gitSpawn(
        dir,
        [...NO_SPLIT_INDEX, "add", "--intent-to-add", "--ignore-removal", "--ignore-errors", "--", "."],
        { env },
      );
      // 1 is `--ignore-errors` having stepped over something; anything higher
      // is git having given up.
      if (added.exitCode <= 1) break;
      if (attempt === INTENT_TO_ADD_ATTEMPTS) return null;
      await Bun.sleep(attempt * INTENT_TO_ADD_BACKOFF_MS);
    }
    const { stdout, exitCode } = await gitSpawn(
      dir,
      [...NO_SPLIT_INDEX, "diff", "--no-renames", "--diff-filter=A"],
      { env },
    );
    return exitCode === 0 ? withoutGitlinks(stdout) : null;
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

/** `update-index --index-info` input that settles every unmerged path to one
 * stage-0 entry, from `ls-files -z --unmerged` output — `<mode> <sha> <stage>\t
 * <path>` records, one per stage — or the empty string when there is nothing
 * unmerged. Which stage's blob is used does not matter: the entry exists so
 * that `git add .` sees a tracked file and the diff filter sees a
 * modification, and neither reads the blob. Exported for its test. */
export function settledStages(unmergedList: string): string {
  const seen = new Set<string>();
  let out = "";
  for (const record of unmergedList.split("\0")) {
    if (record === "") continue;
    const tab = record.indexOf("\t");
    const [mode, sha] = record.slice(0, tab).split(" ");
    const file = record.slice(tab + 1);
    if (!mode || !sha || seen.has(file)) continue;
    seen.add(file);
    out += `${mode} ${sha} 0\t${file}\0`;
  }
  return out;
}

/** Drop the sections of a scratch-index diff that describe a gitlink — a
 * nested repository `git add .` recorded — leaving only real files. Exported
 * for its test; see `diffUntrackedFiles`.
 *
 * Splitting on the header is safe because every line of content inside a
 * section carries a prefix — `+`, `-`, a space, `\` — so a file that is itself
 * a patch cannot start a section from inside one. */
export function withoutGitlinks(diff: string): string {
  if (!diff.includes("\nnew file mode 160000\n")) return diff;
  return diff
    .split(/^(?=diff --git )/m)
    .filter((section) => !/^diff --git [^\n]*\nnew file mode 160000\n/.test(section))
    .join("");
}
