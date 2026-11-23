// Run git via Bun.spawn (not Bun.$) so large output streams through a pipe
// rather than buffering in a shell — Bun.$ deadlocks when many concurrent shells
// each buffer large stdout (e.g. multi-MB files or patch output).
export interface GitSpawnOptions {
  // Kill the child if it has not exited within this many milliseconds. git can
  // block indefinitely — a stalled network mount, a contended index.lock — and
  // an abandoned child holds its stdout pipe for the life of the daemon.
  // Racing the promise is not enough: the loser keeps running.
  //
  // A killed child exits 143 (128 + SIGTERM), so the usual `exitCode !== 0`
  // check treats a timeout as a failed lookup without any special casing.
  timeoutMs?: number;
  // Keep git's stderr instead of discarding it. Off by default because the
  // read routes ask git questions whose failure *is* the answer — a path with
  // no history, a ref that is not there — and reading a pipe nobody wants is
  // work per call for a string thrown away.
  //
  // Worth it where a failure has to be reported rather than absorbed: git says
  // why in stderr and nowhere else, and "worktree add failed" without
  // "fatal: invalid reference: nosuchref" is a message the user can do nothing
  // with (TASK-29).
  captureStderr?: boolean;
  // Extra environment for the child, merged over the daemon's own.
  //
  // Two callers need it and both are the WIP snapshot (§5.6). `GIT_INDEX_FILE`
  // is the whole reason the snapshot can be taken without touching the live
  // tree: it points `read-tree`/`add`/`write-tree` at a throwaway index, and it
  // cannot be passed as a flag because git only reads it from the environment.
  // `GIT_AUTHOR_*`/`GIT_COMMITTER_*` are the second: `commit-tree` refuses to
  // build a commit with no identity — `user.useConfigOnly = true` is a real
  // configuration and it fails there — and a snapshot of someone's scratch
  // work is ours rather than theirs, so it should not carry their name.
  env?: Record<string, string>;
  // Text to feed the child on stdin, for the commands that take their input
  // there rather than in argv — `cat-file --batch-check`, which answers a whole
  // list of revisions in one spawn instead of one spawn each (TASK-110).
  //
  // Bun takes a Blob, not a string; with nothing here stdin is left at its
  // default, which is what every other caller wants.
  stdin?: string;
  // Stop reading, and kill the child, once stdout passes this many bytes. For
  // the one caller whose output has no natural bound: a commit diffed against
  // an arbitrary base (TASK-128), where an old tag on a large repository is
  // gigabytes of patch held as one string in the daemon every task's terminal
  // lives in. The result says `overflowed`, and its stdout is whatever fitted —
  // cut mid-line, so for reporting the fact rather than for parsing.
  maxStdoutBytes?: number;
}

/** A child's stdout as text, read until it ends or passes `maxBytes`. */
async function readCapped(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  onOverflow: () => void,
): Promise<{ text: string; overflowed: boolean }> {
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { text: text + decoder.decode(), overflowed: false };
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      onOverflow();
      await reader.cancel();
      return { text, overflowed: true };
    }
    text += decoder.decode(value, { stream: true });
  }
}

export async function gitSpawn(
  dir: string,
  args: string[],
  options?: GitSpawnOptions,
): Promise<{ stdout: string; stderr: string; exitCode: number; overflowed?: boolean }> {
  const capture = options?.captureStderr === true;
  const proc = Bun.spawn(["git", "-C", dir, ...args], {
    stdout: "pipe",
    stderr: capture ? "pipe" : "ignore",
    ...(options?.stdin !== undefined ? { stdin: new Blob([options.stdin]) } : {}),
    // Merged rather than replaced: Bun takes `env` as the child's whole
    // environment, and a git that lost PATH, HOME and the ssh-agent socket
    // would fail in ways that have nothing to do with what was asked of it.
    ...(options?.env ? { env: { ...process.env, ...options.env } } : {}),
  });
  const timer =
    options?.timeoutMs === undefined ? null : setTimeout(() => proc.kill(), options.timeoutMs);
  try {
    // Both pipes are drained in the same `Promise.all` as `exited`, and that is
    // not tidiness: a child whose stderr fills the pipe buffer blocks writing
    // to it, so awaiting `exited` first would hang on exactly the failure this
    // option exists to report — the verbose one.
    //
    // The kill ends every await here: the pipes hit EOF and `exited` resolves,
    // so this never outlives the child.
    const maxBytes = options?.maxStdoutBytes;
    const [out, stderr, exitCode] = await Promise.all([
      maxBytes === undefined
        ? new Response(proc.stdout).text().then((text) => ({ text, overflowed: false }))
        : readCapped(proc.stdout, maxBytes, () => proc.kill()),
      capture ? new Response(proc.stderr).text() : Promise.resolve(""),
      proc.exited,
    ]);
    return { stdout: out.text, stderr, exitCode, ...(out.overflowed ? { overflowed: true } : {}) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Raw-bytes variant of gitSpawn for blob content that must not be decoded as
// text (binary detection needs the raw bytes). Same rationale: Bun.spawn (not
// Bun.$) so large output streams through a pipe rather than buffering in a shell.
// `stdin` is for `cat-file --batch`, which is handed its list of objects there;
// `timeoutMs` kills a child that hangs, as in `gitSpawn`.
export async function gitSpawnRaw(
  dir: string,
  args: string[],
  options?: Pick<GitSpawnOptions, "stdin" | "timeoutMs">,
): Promise<{ bytes: Uint8Array; exitCode: number }> {
  const proc = Bun.spawn(["git", "-C", dir, ...args], {
    stdout: "pipe",
    stderr: "ignore",
    ...(options?.stdin !== undefined ? { stdin: new Blob([options.stdin]) } : {}),
  });
  const timer =
    options?.timeoutMs === undefined ? null : setTimeout(() => proc.kill(), options.timeoutMs);
  try {
    const [buffer, exitCode] = await Promise.all([new Response(proc.stdout).arrayBuffer(), proc.exited]);
    return { bytes: new Uint8Array(buffer), exitCode };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
