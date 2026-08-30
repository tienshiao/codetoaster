---
id: TASK-47
title: resume.test.ts flakes on the could_not_resume ladder case
status: Done
assignee:
  - '@claude'
created_date: '2026-08-30 00:09'
updated_date: '2026-08-30 20:42'
labels:
  - test
  - flaky
dependencies: []
ordinal: 47000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`resume.test.ts` > "when nothing opens, the task is a card with a button, not a dead terminal" (src/lib/tasks/resume.test.ts:254) fails roughly one run in eight.

Measured: 8 runs of the file on the current tree gave 1 failure; 8 runs with the TASK-46 code-review's manager.ts/snapshot.ts fixes stashed gave 1 failure. So the flake is pre-existing and not caused by the suspendTask-awaits-resume change — it was simply not noticed until the file was run in a loop.

The test drives the full ladder with both rungs failing, so it depends on `awaitAgentStart` timing out twice against a fake agent; the assertion that most plausibly loses the race is `expect(await agent.settled(2)).toHaveLength(2)`, which wants both spawns to have settled. Worth capturing the actual failing assertion before fixing — a single loop run reproduces it often enough.

A one-in-eight flake in the resume path is the kind that erodes trust in the suite exactly where the suite matters most, so it should be made deterministic rather than retried.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The failing assertion and its actual-vs-expected values are captured from a real failing run
- [x] #2 The test is deterministic: 50 consecutive runs of resume.test.ts pass
- [x] #3 The fix removes the timing dependency rather than widening a timeout or adding a retry
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Measure first: instrument awaitAgentStart. Failing rungs resolve at 212-260ms against a 400ms cap — ~150ms of headroom, and a 20-run loop reproduces the flake on a *different* test than the one filed, so this is a class of flake covering every test whose rung must be observed as failed.
2. Root cause: the stand-in agent never reports a hook, so 'this rung stayed up' can only be decided by the cap — a wall clock racing the sh script's exit. The real agent reports a hook; the stand-in does not, which is why the cap became load-bearing in tests it was never meant to decide.
3. Fix: the stand-in reports. On the success path only (before exec cat) it appends CODETOASTER_TASK_ID to a hooks log; newManager runs a watcher that drains that log into manager.applyHook, standing in for the HTTP hook endpoint. A failing rung writes nothing, so it is still observed by pty.exited.
4. The payload deliberately carries no transition (an event transitionFor does not map), so it sets hookSeen and moves no row: applyHook records 'the hooks are wired up' before mapping, which is the only thing awaitAgentStart reads. A SessionStart would pre-satisfy the row writes the ladder is under test for.
5. With both outcomes observed, the cap decides nothing: setStartTimeout goes to a value that must never be reached, and the file gets faster rather than slower (no rung waits out 400ms).
6. Add a test for the cap path itself, which nothing would otherwise cover once the stand-in reports: a silent stand-in plus a short cap, asserting quiet-but-alive is declared started.
7. Verify: 50 consecutive runs of resume.test.ts, plus the full suite.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC#1 satisfied — captured from a real failing run on 2026-08-30:

  expect(received).toBe(expected)
  Expected: "could_not_resume"
  Received: "starting"
  at src/lib/tasks/resume.test.ts:269
  (fail) resuming a suspended task > when nothing opens, the task is a card with a button, not a dead terminal

Mechanism, from the code review: `setStartTimeout(400)` races the stand-in agent, which is a /bin/sh script that has to be spawned, exec'd, write its log line and exit before the cap decides it stayed alive. When the cap wins, a rung that failed is recorded as a success — hence 'starting' where the ladder should have exhausted itself into 'could_not_resume'.

Two things tried and their results:
- `awaitAgentStart`'s cap now resolves `!pty.exited` instead of a bare `true` (landed, independently correct — the cap means 'quiet but still up', and a corpse is neither). This narrows the window but does NOT close it: still reproduced 1 run in 12 at 400ms.
- The review widened the cap to 1000ms. Reverted: that is precisely what AC#3 rules out, and it took the file from 9s to 19s.

So the remaining work is AC#2 and AC#3, and the shape of the fix is now clear: the test must not race the stand-in at all. The agent stub should signal its outcome deterministically — awaiting the spawned process's exit, or having the fake write a marker the harness waits on — so 'the rung failed' is observed rather than inferred from a wall clock.

Fixed, and the flake was a class rather than the one filed case.

Root cause. `awaitAgentStart` settles on a hook, on the PTY exiting, or on a cap that reads 'quiet but still up' as a working agent. The first two are observations; the cap is a guess. The stand-in agent never reported a hook, so the guess was the only way a *surviving* rung could be recognised — which made the cap load-bearing in every test whose rung had to be seen to FAIL, racing it against that rung's death.

The margin was far thinner than the numbers suggested. The cap was 400ms and the stand-in exits in 6-8ms (measured directly through Bun.spawn with pty), but awaitAgentStart did not observe those exits until 212-260ms: it polls at 25ms and the resume path it polls from is busy enough that ticks do not land when due. So the race was ~250ms against 400ms.

Evidence it is a class: a 20-run loop on the pre-fix tree failed on 'a failed rung's death does not follow the task that recovered', NOT the filed case. Under 6x parallel contention the pre-fix file failed 24/24 runs across 8 distinct tests.

Fix. The stand-in reports, the way a real agent does through `codetoaster hook`. On the success path only — after the failure check, before `exec cat` — it appends CODETOASTER_TASK_ID to a hooks log, and newManager runs a relay that carries each line into manager.applyHook, standing in for the HTTP hook route there is no server to provide. A failing rung writes nothing and is still recognised by its exit. With both outcomes signalled the cap decides nothing, so setStartTimeout goes to 30s (CAP_NEVER_MS) and the file got FASTER, not slower: 9s to 5.9s, because no rung waits out 400ms any more.

The relayed payload deliberately maps to no transition (PreToolUse). applyHook records 'the hooks are wired up' for any payload before the mapping runs, and that flag is the entirety of what awaitAgentStart reads — so this exercises the weakest signal that counts. A SessionStart would also work and would be worse: it writes lifecycle/agent_state/session id, pre-satisfying row changes the ladder tests exist to check the ladder itself makes.

Two coverage repairs that came with it. 'a hook settles the start sooner than the cap' now uses a silenced stand-in, since otherwise it would assert on whichever of two hooks arrived first — a race the change would have introduced. And a new test covers the cap path itself, which nothing would otherwise reach once every stand-in reports: a silent stand-in that neither reports nor exits, where the cap is the only thing that can settle it.

Verification. AC#2: 50 consecutive runs, 0 failures. Also 18/18 under 3x parallel contention. Full suite 684 unit + 56 render, tsc clean.

Honest limit: under 6x parallel contention 6 of 24 runs still fail, but as 5001ms hangs on Bun's test timeout rather than wrong answers, and the pre-fix file fails 24/24 under that same load. Measured and ruled out as the cause: PTY spawn stays 6-8ms under that load, and the hook relay delivers in 0-7ms. So it is neither machine saturation nor the relay — it is the resume path's own event-loop behaviour under saturation, which is pre-existing, strictly better than before, and not what this task is about. Worth a separate task if 6x-parallel ever becomes a real CI shape.

Post-review hardening (/code-review --fix), three low-severity findings, all verified rather than taken on trust:

1. The generated stand-in's redirect targets were unquoted. os.tmpdir() honours $TMPDIR, so a temp root with a space sent the invocation and hook logs somewhere else. Pre-existing for the invocation log, newly duplicated for the hook log — and this change made the consequence worse: a hook line that never lands used to fall back to the 400ms cap, and now hangs on CAP_NEVER_MS and surfaces as an opaque 5001ms Bun timeout. Proven both ways under TMPDIR='/tmp/ct has space': quoted 22 pass, unquoted 17 fail.
2. invocations() duplicated read()'s body verbatim; replaced with the function itself.
3. transitionFor not mapping PreToolUse is what the whole determinism argument rests on, and nothing pinned it — PreToolUse is a real event and a natural 'busy' signal, so the day it gains a mapping the relay would start stamping agent_state on every surviving rung with no test failing at the cause. The payload is now RELAYED_HOOK with a test asserting transitionFor(RELAYED_HOOK) is undefined. Confirmed non-vacuous: swapping the event to UserPromptSubmit fails exactly that test.

Not changed, worth knowing: newManager writes the process-global CODETOASTER_AGENT_BIN, so two newManager calls in one test would leave the first manager's relay watching a log nothing writes. No test does this, and fixing it would restructure the helper.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
resume.test.ts was flaky because its stand-in agent never reported a hook. `awaitAgentStart` settles on a hook, on the PTY exiting, or on a cap that treats silence as success — and with the stand-in mute, the cap was the only way a surviving rung could be recognised, which left it racing the death of every rung that was supposed to fail. Measured: the stand-in exits in 6-8ms, but the exit was not observed until 212-260ms (a 25ms poll running on a busy loop), against a 400ms cap. It was never one test either — the pre-fix file failed 24/24 runs under 6x contention across 8 distinct tests.

The stand-in now reports, on its success path only, appending CODETOASTER_TASK_ID to a hooks log that a relay carries into applyHook — standing in for the HTTP hook route there is no server here to provide. A failing rung writes nothing and is still recognised by its exit, so both outcomes are observed and the cap decides nothing: setStartTimeout goes to 30s and the file got faster, 9s to 5.9s. The relayed payload maps to no transition on purpose, so it exercises the weakest signal that counts without pre-satisfying the row writes the ladder tests are checking.

Two coverage repairs came with it: the existing hook test uses a silenced stand-in, since otherwise it would have raced two hooks, and a new test covers the cap path directly, which nothing else reaches once every stand-in reports.

50 consecutive runs pass (AC#2), plus 18/18 under 3x parallel contention. Residue stated in the notes: 6/24 under 6x contention, as timeouts rather than wrong answers, measured and ruled out as neither spawn latency nor the relay.
<!-- SECTION:FINAL_SUMMARY:END -->
