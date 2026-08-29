---
id: TASK-13
title: 'Resume path: POST /api/tasks/:id/resume with fallbacks'
status: Done
assignee: []
created_date: '2026-08-29 00:02'
updated_date: '2026-08-29 07:09'
labels:
  - server
  - agent
  - api
milestone: m-1
dependencies:
  - TASK-11
documentation:
  - docs/v2-architecture.md
priority: high
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Reopen a suspended task (§4.3): run `claude --resume <agent_session_id>` in the task cwd via the normal spawn path (settings, env scrub, env vars). If that fails, fall back in order: (1) `claude --continue` in the cwd; (2) scan ~/.claude/projects/<escaped-cwd>/*.jsonl for the newest transcript with a known sessionId or an mtime inside the task's lifetime; (3) surface a `could not resume` state on the task so the user can choose 'start fresh in this directory'. A fresh start MUST allocate a new uuid — a used --session-id fails with 'already in use'.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 POST /api/tasks/:id/resume on a suspended task spawns claude --resume with the stored id and returns 200 with the TaskInfo
- [x] #2 Resume on a task that is already live is a no-op 200 (idempotent)
- [x] #3 When --resume fails, --continue is tried, then the transcript scan, in that order
- [x] #4 When every fallback fails, the task lands in an actionable could-not-resume state, never a dead terminal
- [x] #5 'Start fresh' allocates a new agent_session_id and writes it to the row before spawning
- [x] #6 Tests cover each fallback rung and the fresh-start id rotation
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
PROBED FIRST (facts the plan rests on):
- claude --resume <unknown-uuid> prints 'No conversation found with session ID: <id>' and exits 1 immediately. It does not hang, so a failed rung is detectable.
- -r/--resume [value] and -c/--continue both exist on the installed binary (2.1.251), as does --fork-session.
- The escaped-cwd directory does not have to be derived at all in the common case: transcript_path is stored from SessionStart, and its dirname IS ~/.claude/projects/<escaped-cwd>. Transcript files are named <sessionId>.jsonl, so the scan reads ids from filenames and times from stat, and never parses a jsonl.

1. Detection is by hook, not by timer. awaitAgentStart(taskId, pty, cap) resolves 'started' when any hook arrives for the task (TASK-12 already tracks that), 'failed' when the PTY exits first, and 'started' on timeout — leaving a live terminal alone is the safer default, and it is what a --bare user with no hooks at all gets. This is far more precise than watching for an early exit, and it is only possible because TASK-11/12 landed first.

2. The whole ladder resolves BEFORE the route answers. The response carries the ptyId clients attach to, so killing and respawning after a client attached would strand it on a dead terminal. Cost is bounded: the common path is one spawn plus one SessionStart.

3. Rungs, in order:
   a. --resume <agent_session_id>, skipped without spawning when the stored transcript_path names a file that is no longer there — a deterministic check that avoids a pointless spawn.
   b. --continue, which takes the most recent conversation in the directory. With worktree-per-task that is unambiguous (§4.3).
   c. Scan dirname(transcript_path), or ~/.claude/projects/<cwd with / -> -> when the row has no transcript_path, for the newest <sessionId>.jsonl whose mtime falls inside the task's lifetime; --resume that id. Skip the rung when the directory does not exist rather than guessing harder.
   d. No spawn. agent_state becomes could_not_resume (a new AgentState value; the column is TEXT so it is a type change only) and the route answers 200 with the task, so the card can offer 'start fresh' instead of showing a dead terminal.
   Rungs b and c self-heal the row: whatever conversation actually opens reports its own SessionStart, and TASK-11's mapping overwrites agent_session_id with it.

4. buildAgentCommand grows a mode — start | resume | continue — sharing the settings, model, permission-mode and env-scrub path exactly. A resume carries no positional prompt: the conversation already holds it.

5. POST /api/tasks/:id/resume. 404 unknown task; 200 no-op when already live (#2); 409 for an archived task. Body {fresh: true} skips the ladder entirely, mints a NEW uuid and writes it to the row before spawning — reusing the stored id fails with 'already in use' and would retry-loop the task forever (§4.3).

6. The resumed PTY is restored at last_size_cols/last_size_rows, adopted the same way createTask adopts one, has its hook grace armed, and sets lifecycle live.

7. Tests: each rung reached in order using a stand-in agent binary that can be told which invocation to fail; the fresh-start id rotation; already-live idempotency; and the could-not-resume landing. The stand-in reports hooks by curl-ing the daemon, so the hook-based detection is exercised rather than mocked.

8. Then /code-review --fix and /verify.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented as planned, then substantially corrected by live verification. Three things the plan got wrong, all found by running it:

1. THE PREMISE WAS WRONG. The plan rested on 'claude --resume <unknown-id> exits 1 immediately, so a failed rung is detectable'. That is true down a pipe and FALSE in a PTY: it prints 'No conversation found with session ID: ...' and stays running. A doomed rung is therefore indistinguishable from a healthy one — no exit, and no hook either — and the 4s cap declared the dead first rung a success, so the ladder never ran. Detection cannot be after the fact; canResumeSessionId now checks for <id>.jsonl in the task's transcript directory and keeps the doomed rung OFF the ladder. A directory we cannot read answers true, since not being able to disprove something is not evidence against it.

2. --continue GRABBED THE WRONG CONVERSATION. §4.3 calls it unambiguous because worktree-per-task means one directory holds one conversation — which is not true until m-4. Resuming in this repo, --continue would have opened the conversation of the very session doing the work, because that was the most recent transcript in the directory. continueIsSafe now offers the rung only when the newest transcript in the directory is the one the task itself reported. Opening a stranger's conversation is worse than not resuming.

3. HOOKS FROM A PREVIOUS AGENT VOUCHED FOR THE NEXT. hookSeen is 'has this task ever reported', but awaitAgentStart needs 'has the process running now reported'. Resuming twice inside one daemon short-circuited to success before the new process had drawn a character. spawnAgent now clears the flag, which is the right meaning for TASK-12's use of it too.

Added a rung the plan did not have, and it is the one that does the work: resume the id taken from the row's own transcript_path filename. transcript_path came from the agent's SessionStart and names the conversation directly, so it recovers a task whose stored id has gone stale.

Code review found four more, all fixed: a successful resume never cleared the previous process's 'exited' verdict, so a task resumed on rung 2 ran fine and showed as dead forever; concurrent resumes started two agents on one conversation (in-flight guard added); a resumed task was live but absent from the sidebar, because loadProjects starts every project empty and resumeTask never placed it back; and projectsDirFor replaced only '/' when Claude Code replaces every non-alphanumeric character (evidenced by -Users-tma--agent-os-... for /Users/tma/.agent-os/...). Separately, a test caught findResumableTranscript rejecting the newest candidate: mtimeMs has sub-millisecond precision and Date.now() does not, so an upper bound of 'now' excluded a transcript written in that same millisecond.

Runtime verification across four daemon restarts against one database:
- Task created with 'remember the word BANANA'. Daemon killed; row survived as suspended.
- POST resume -> live, idle, same agent_session_id, and the task present in GET /api/tasks (the sidebar fix).
- Asked the resumed agent what word it was told to remember: it answered BANANA, captured as last_message. The conversation genuinely survived the restart.
- Stored id then corrupted to a bogus uuid: the ladder skipped the doomed rung, resumed the conversation named by transcript_path, and healed agent_session_id back to the real one. Verified the live process is 'claude --resume 8aaeb529... --settings ...'.
bun test 368 pass / 0 fail; bunx tsc --noEmit clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
POST /api/tasks/:id/resume reopens a suspended task, walking the §4.3 ladder before it answers so no client attaches to a terminal that is about to be killed. Rungs: the stored conversation, the one the row's transcript_path names, --continue, and a scan of the task's transcript directory — each offered only when it can actually work, because live verification showed a doomed --resume neither exits nor reports in a PTY, and that --continue opens whatever conversation is newest in a shared directory, which in testing was the operator's own. Success is decided by the agent's first hook rather than a timer, {fresh:true} mints a new uuid before spawning, and a task that cannot be reopened lands on could_not_resume with a button rather than a dead terminal. Verified by killing a daemon and having the resumed agent recall a word from before the restart, and by corrupting the stored id and watching the ladder heal it.
<!-- SECTION:FINAL_SUMMARY:END -->
