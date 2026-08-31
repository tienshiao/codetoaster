import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/** Where Claude Code keeps a directory's conversations. Derived only as a last
 * resort: a task that has ever reported a SessionStart carries the real path
 * on its row, and `path.dirname` of it is this directory exactly — no guessing
 * at an escaping rule we would only be inferring from examples.
 *
 * Separators are not the only thing replaced: `/Users/me/.claude/worktrees/x`
 * is stored as `-Users-me--claude-worktrees-x`, so a dot becomes a dash too,
 * and replacing only `/` sends the scan to a path that does not exist —
 * quietly costing the ladder its last rung. Observed for `/` and `.`; the
 * class below is the conservative reading of that, not a documented rule, so
 * treat a miss as expected rather than surprising. Being wrong is cheap: the
 * directory will not exist, `listTranscripts` answers empty, and the rung is
 * skipped rather than doing something wrong. */
export function projectsDirFor(cwd: string): string {
  return path.join(os.homedir(), ".claude", "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"));
}

/** The directory to search for a task's conversations: the one its transcript
 * actually sits in when we know it, and the derived guess otherwise. */
export function transcriptDirFor(task: { cwd: string; transcript_path: string | null }): string {
  return task.transcript_path ? path.dirname(task.transcript_path) : projectsDirFor(task.cwd);
}

export interface TranscriptCandidate {
  sessionId: string;
  path: string;
  modifiedAt: number;
}

/** The conversations in a directory, newest first. Transcript files are named
 * `<sessionId>.jsonl`, so the id comes off the filename and the time off
 * `stat` — there is never a reason to parse a jsonl to answer this. */
export function listTranscripts(dir: string): TranscriptCandidate[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    // No directory is a normal answer, not a failure: a task whose agent never
    // started has no conversations to find.
    return [];
  }

  const found: TranscriptCandidate[] = [];
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    const full = path.join(dir, name);
    try {
      const stat = fs.statSync(full);
      if (!stat.isFile()) continue;
      found.push({
        sessionId: name.slice(0, -".jsonl".length),
        path: full,
        modifiedAt: stat.mtimeMs,
      });
    } catch {
      // Vanished between readdir and stat. Nothing to do but skip it.
    }
  }
  return found.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

/** The best candidate to resume for a task whose stored id is unusable
 * (§4.3, rung 3): the newest conversation in its directory that was touched
 * during the task's life. The window is what keeps this from grabbing a
 * conversation that belongs to something else entirely — someone else's
 * `claude` in the same directory, or the task that used it before this one.
 *
 * `notThis` is the id we already tried, so a scan cannot hand back the same
 * unusable conversation and send the caller round again.
 *
 * Not on the ladder at present, and kept rather than deleted: TASK-43 showed
 * the window alone cannot tell this task's conversation from a stranger's in a
 * shared directory, so `resumeLadder` stops one rung short of it and says why.
 * A worktree makes the directory the task's alone, which is the condition this
 * always needed; TASK-60 reinstates the rung there. */
export function findResumableTranscript(
  task: { cwd: string; transcript_path: string | null; created_at: number },
  options: { notThis?: string | null } = {},
): TranscriptCandidate | undefined {
  return listTranscripts(transcriptDirFor(task)).find(
    (candidate) =>
      candidate.sessionId !== options.notThis &&
      // Only a lower bound. An upper one reads as symmetry and is a trap:
      // `mtimeMs` carries sub-millisecond precision while `Date.now()` is
      // whole milliseconds, so a transcript written in the same millisecond as
      // the scan has an mtime *after* "now" and would be rejected — which is
      // exactly the newest, most likely candidate. Nothing is gained by
      // refusing a file with a future timestamp anyway.
      candidate.modifiedAt >= task.created_at,
  );
}

/** The conversation id a transcript path names. Transcripts are files called
 * `<sessionId>.jsonl`, so this is the id of the conversation the task itself
 * last reported — which is a far better thing to resume than a row field that
 * may have gone stale. */
export function sessionIdFromTranscript(transcriptPath: string | null): string | undefined {
  if (!transcriptPath) return undefined;
  const name = path.basename(transcriptPath);
  return name.endsWith(".jsonl") ? name.slice(0, -".jsonl".length) : undefined;
}

/** Whether `--continue` would open this task's conversation or somebody
 * else's. It takes "the most recent conversation in this directory", which
 * §4.3 calls unambiguous because worktree-per-task means one directory holds
 * exactly one conversation. Until worktrees land (m-4) that is simply not
 * true: a directory can hold the task's conversation, another task's, and the
 * conversation of whoever is running an agent there by hand.
 *
 * So it is offered only when the newest transcript in the directory is one we
 * can *name* as this task's. Two things can name one: the path the agent
 * reported at its SessionStart, and — for a task that never reported one — the
 * id we minted and passed to `--session-id`, which nothing else in the
 * directory can be called, because we generated it.
 *
 * A row with no reported transcript used to answer `true`, on the reading that
 * a guard unable to tell should not stand in the way. That was backwards, and
 * it is the whole of TASK-43. This is asked only after the ladder has already
 * declined or failed the minted id, so for such a row that conversation is not
 * in the directory — which makes the newest thing there something we never
 * started, and `--continue` would bind the task to it permanently at its next
 * SessionStart. Being unable to tell is the reason to refuse: refusing costs a
 * rung, allowing costs somebody else's conversation.
 *
 * Seeing nothing at all answers `false` for the same reason. An empty
 * directory would make `--continue` merely useless — but we may equally be
 * looking in the wrong one, since `projectsDirFor` only guesses at the
 * escaping rule, and `--continue` opens what is really there rather than what
 * our guess found. */
export function continueIsSafe(task: {
  cwd: string;
  transcript_path: string | null;
  agent_session_id?: string | null;
}): boolean {
  const ours = sessionIdFromTranscript(task.transcript_path) ?? task.agent_session_id;
  if (!ours) return false;
  return listTranscripts(transcriptDirFor(task))[0]?.sessionId === ours;
}

/** Whether it is worth asking to resume a particular conversation: is there a
 * transcript for it in the task's directory?
 *
 * This is the check that keeps a doomed rung off the ladder, and it has to be
 * a check rather than something detected afterwards. `claude --resume` on an
 * id with no conversation exits 1 when its output is a pipe — but in a PTY it
 * prints the same message and *stays running*, so a failed rung looks exactly
 * like a healthy one from the outside: no exit, and no hook either. Verified
 * against 2.1.251, in both directions.
 *
 * A directory we cannot read answers `true`: not being able to disprove
 * something is not evidence against it, and a task whose agent never reported
 * a transcript path still deserves its first rung. */
export function canResumeSessionId(
  task: { cwd: string; transcript_path: string | null },
  sessionId: string,
): boolean {
  const dir = transcriptDirFor(task);
  try {
    if (!fs.statSync(dir).isDirectory()) return true;
  } catch {
    return true;
  }
  return transcriptExists(path.join(dir, `${sessionId}.jsonl`));
}

/** Whether the conversation the row names is still on disk. A missing
 * transcript is the one resume failure worth predicting rather than
 * discovering: it costs a `stat` and saves spawning a process that can only
 * print "No conversation found" and exit. */
export function transcriptExists(transcriptPath: string | null): boolean {
  if (!transcriptPath) return false;
  try {
    return fs.statSync(transcriptPath).isFile();
  } catch {
    return false;
  }
}
