import { test, expect, describe, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  continueIsSafe,
  findResumableTranscript,
  sessionIdFromTranscript,
  listTranscripts,
  projectsDirFor,
  transcriptDirFor,
  transcriptExists,
} from "./transcripts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function transcriptDir(files: Array<{ name: string; ageMs?: number }>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-transcripts-"));
  dirs.push(dir);
  for (const file of files) {
    const full = path.join(dir, file.name);
    fs.writeFileSync(full, "{}");
    if (file.ageMs) {
      const when = new Date(Date.now() - file.ageMs);
      fs.utimesSync(full, when, when);
    }
  }
  return dir;
}

describe("finding a task's conversations", () => {
  test("uses the directory the transcript is actually in, not a derived one", () => {
    const task = { cwd: "/Users/me/proj", transcript_path: "/somewhere/else/abc.jsonl" };
    // The row knows where its transcript is, so there is nothing to derive —
    // and no escaping rule to get wrong.
    expect(transcriptDirFor(task)).toBe("/somewhere/else");
  });

  test("derives one only when the row has never been told", () => {
    const task = { cwd: "/Users/me/proj", transcript_path: null };
    expect(transcriptDirFor(task)).toBe(projectsDirFor("/Users/me/proj"));
    expect(projectsDirFor("/Users/me/proj"))
      .toBe(path.join(os.homedir(), ".claude", "projects", "-Users-me-proj"));
    // Every non-alphanumeric character, not just the separator: a worktree
    // under a dot-directory is a real cwd, and replacing only "/" would point
    // the scan at a directory that does not exist.
    expect(projectsDirFor("/Users/me/.claude/worktrees/a_b"))
      .toBe(path.join(os.homedir(), ".claude", "projects", "-Users-me--claude-worktrees-a-b"));
  });

  test("reads ids off filenames, newest first, ignoring anything else", () => {
    const dir = transcriptDir([
      { name: "older.jsonl", ageMs: 60_000 },
      { name: "newest.jsonl" },
      { name: "notes.txt" },
    ]);

    expect(listTranscripts(dir).map((t) => t.sessionId)).toEqual(["newest", "older"]);
  });

  test("a directory that is not there is an empty answer, not a failure", () => {
    expect(listTranscripts("/no/such/directory")).toEqual([]);
  });

  test("takes the newest conversation from inside the task's life", () => {
    const dir = transcriptDir([{ name: "mine.jsonl" }, { name: "older-mine.jsonl", ageMs: 5_000 }]);
    const task = { cwd: "/x", transcript_path: path.join(dir, "mine.jsonl"), created_at: Date.now() - 60_000 };

    expect(findResumableTranscript(task)!.sessionId).toBe("mine");
  });

  // The window is the only thing standing between a scan and someone else's
  // conversation in the same directory.
  test("ignores a conversation from before the task existed", () => {
    const dir = transcriptDir([{ name: "someone-elses.jsonl", ageMs: 86_400_000 }]);
    const task = { cwd: "/x", transcript_path: path.join(dir, "gone.jsonl"), created_at: Date.now() - 60_000 };

    expect(findResumableTranscript(task)).toBeUndefined();
  });

  // Regression: mtimeMs carries sub-millisecond precision and Date.now() does
  // not, so an upper bound of "now" rejects the file written this instant —
  // the newest candidate, and the one most likely to be right.
  test("takes a conversation written in this very millisecond", () => {
    const dir = transcriptDir([{ name: "just-now.jsonl" }]);
    const task = { cwd: "/x", transcript_path: path.join(dir, "x.jsonl"), created_at: Date.now() - 1_000 };

    expect(findResumableTranscript(task)!.sessionId).toBe("just-now");
  });

  test("never hands back the conversation that just failed", () => {
    const dir = transcriptDir([{ name: "the-broken-one.jsonl" }]);
    const task = {
      cwd: "/x",
      transcript_path: path.join(dir, "the-broken-one.jsonl"),
      created_at: Date.now() - 60_000,
    };

    expect(findResumableTranscript(task, { notThis: "the-broken-one" })).toBeUndefined();
  });
});

describe("transcriptExists", () => {
  test("answers for a file, a missing path, and no path at all", () => {
    const dir = transcriptDir([{ name: "here.jsonl" }]);

    expect(transcriptExists(path.join(dir, "here.jsonl"))).toBe(true);
    expect(transcriptExists(path.join(dir, "gone.jsonl"))).toBe(false);
    expect(transcriptExists(dir)).toBe(false);
    expect(transcriptExists(null)).toBe(false);
  });
});

describe("continueIsSafe", () => {
  test("safe when the newest conversation is the one the task reported", () => {
    const dir = transcriptDir([{ name: "ours.jsonl" }, { name: "older.jsonl", ageMs: 60_000 }]);
    expect(continueIsSafe({ cwd: "/x", transcript_path: path.join(dir, "ours.jsonl") })).toBe(true);
  });

  // TASK-43. A row that never reported a transcript used to answer `true` on
  // the grounds that it could not tell — but this is asked only after the
  // ladder has declined or failed the minted id, so there is no conversation
  // of ours in the directory and the newest one is by elimination a
  // stranger's. `--continue` would take exactly that, and its SessionStart
  // would bind the task to it for good.
  test("unsafe for a row whose id has no transcript and a stranger's is newest", () => {
    // Reached through the derived directory, because that is how such a row is
    // really read: with no transcript_path there is nothing to take a dirname
    // of, and the lookup guesses at where the conversations are.
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-cwd-"));
    dirs.push(cwd);
    const derived = projectsDirFor(cwd);
    fs.mkdirSync(derived, { recursive: true });
    dirs.push(derived);
    fs.writeFileSync(path.join(derived, "someone-elses.jsonl"), "{}");

    expect(continueIsSafe({ cwd, transcript_path: null, agent_session_id: "never-written" }))
      .toBe(false);
  });

  // The one case a row with no reported transcript can still make: the id we
  // minted and passed to `--session-id` names a conversation nothing else
  // could be called, so finding it newest is proof and not a guess. This is
  // what keeps a degraded task — one whose hooks never arrived, so no
  // SessionStart ever set transcript_path — resumable.
  test("a minted id names the conversation when no transcript was ever reported", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-cwd-"));
    dirs.push(cwd);
    const derived = projectsDirFor(cwd);
    fs.mkdirSync(derived, { recursive: true });
    dirs.push(derived);
    fs.writeFileSync(path.join(derived, "minted.jsonl"), "{}");
    const older = path.join(derived, "older.jsonl");
    fs.writeFileSync(older, "{}");
    const then = new Date(Date.now() - 60_000);
    fs.utimesSync(older, then, then);

    expect(continueIsSafe({ cwd, transcript_path: null, agent_session_id: "minted" })).toBe(true);
  });

  // Seeing nothing is not evidence of safety. The directory may hold nothing,
  // in which case refusing costs a rung that would have opened nothing — or
  // `projectsDirFor` may simply have guessed the escaping rule wrong, and
  // `--continue` opens what is really in the cwd rather than what we found.
  test("unsafe when the directory shows nothing at all", () => {
    expect(continueIsSafe({
      cwd: "/no/such/directory",
      transcript_path: null,
      agent_session_id: "minted",
    })).toBe(false);
  });

  // The case that turned up in live verification: a resume in a repo where
  // another agent was running picked up *that* conversation, because
  // `--continue` takes the most recent one in the directory and the directory
  // was shared. §4.3 calls it unambiguous on the strength of worktree-per-task,
  // which is not true until m-4.
  test("unsafe when somebody else's conversation is the most recent one", () => {
    const dir = transcriptDir([
      { name: "someone-elses.jsonl" },
      { name: "ours.jsonl", ageMs: 60_000 },
    ]);
    expect(continueIsSafe({ cwd: "/x", transcript_path: path.join(dir, "ours.jsonl") })).toBe(false);
  });
});

describe("sessionIdFromTranscript", () => {
  test("reads the conversation id out of the filename", () => {
    expect(sessionIdFromTranscript("/a/b/1fc1-abcd.jsonl")).toBe("1fc1-abcd");
    expect(sessionIdFromTranscript("/a/b/notes.txt")).toBeUndefined();
    expect(sessionIdFromTranscript(null)).toBeUndefined();
  });
});
