import { test, expect, describe } from "bun:test";
import { transitionFor, isHookPayload } from "./hook-state";

// The payloads captured live in the Phase 0 spike (docs/v2-architecture.md
// §4.2), kept verbatim so a future Claude Code that changes their shape shows
// up here rather than as a task list that quietly stops moving.
const SESSION_START = {
  session_id: "1fc1aaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  transcript_path: "~/.claude/projects/-Users-me-proj/1fc1.jsonl",
  cwd: "/Users/me/proj",
  hook_event_name: "SessionStart",
  source: "startup",
};
const STOP = {
  session_id: "1fc1aaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  hook_event_name: "Stop",
  last_assistant_message: "pong",
  permission_mode: "auto",
  effort: { level: "high" },
};
const SESSION_END = {
  session_id: "1fc1aaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  hook_event_name: "SessionEnd",
  reason: "other",
};

describe("transitionFor", () => {
  test("SessionStart records the conversation and brings the task live", () => {
    const update = transitionFor(SESSION_START, 1000);

    expect(update).toEqual({
      agent_session_id: SESSION_START.session_id,
      transcript_path: SESSION_START.transcript_path,
      agent_state: "idle",
      lifecycle: "live",
      last_active_at: 1000,
      // Restamped: the value in the column belongs to the conversation that
      // just ended, and leaving it would make a freshly cleared session look
      // like it had been idle for however long the last one was.
      idle_since: 1000,
    });
  });

  test("UserPromptSubmit is the only thing that means busy", () => {
    expect(transitionFor({ hook_event_name: "UserPromptSubmit" }, 5)).toEqual({
      agent_state: "busy",
      last_active_at: 5,
    });
  });

  test("Stop stores the reply as the card preview and stamps idle_since", () => {
    expect(transitionFor(STOP, 42)).toEqual({
      agent_state: "idle",
      last_message: "pong",
      idle_since: 42,
      last_active_at: 42,
    });
  });

  test("Stop with nothing to quote leaves the last message alone", () => {
    const update = transitionFor({ hook_event_name: "Stop" }, 42)!;
    expect(update).not.toHaveProperty("last_message");
    expect(update.agent_state).toBe("idle");
  });

  test("Notification is what the task list is for", () => {
    expect(transitionFor({ hook_event_name: "Notification" }, 1)!.agent_state)
      .toBe("needs_attention");
  });

  test("PreCompact is cosmetic but visible", () => {
    expect(transitionFor({ hook_event_name: "PreCompact" }, 1)!.agent_state)
      .toBe("compacting");
  });

  test("SessionEnd ends the task when the process is actually going away", () => {
    expect(transitionFor(SESSION_END, 1)!.agent_state).toBe("exited");
    for (const reason of ["logout", "prompt_input_exit"]) {
      expect(transitionFor({ hook_event_name: "SessionEnd", reason }, 1)!.agent_state)
        .toBe("exited");
    }
  });

  // The one that would strand a task: /clear fires SessionEnd on the old id
  // before SessionStart brings the new one. Treating that as an exit flickers
  // every /clear through "dead", and leaves the task there for good if the
  // SessionStart never arrives.
  test("SessionEnd from a /clear or a resume is not an exit", () => {
    expect(transitionFor({ hook_event_name: "SessionEnd", reason: "clear" }, 1)).toBeUndefined();
    expect(transitionFor({ hook_event_name: "SessionEnd", reason: "resume" }, 1)).toBeUndefined();
    // A reason we have never seen is not an exit either: a task that is still
    // running must not be marked dead by a word we do not recognise.
    expect(transitionFor({ hook_event_name: "SessionEnd", reason: "teleported" }, 1)).toBeUndefined();
    expect(transitionFor({ hook_event_name: "SessionEnd" }, 1)).toBeUndefined();
  });

  test("/clear keeps the task and swaps the conversation underneath it", () => {
    // SessionEnd on the old id changes nothing...
    expect(transitionFor({ hook_event_name: "SessionEnd", reason: "clear" }, 1)).toBeUndefined();
    // ...and the SessionStart that follows carries a NEW session_id, which
    // simply overwrites the field. The task's identity is ours.
    const restarted = transitionFor(
      { hook_event_name: "SessionStart", source: "clear", session_id: "new-id" },
      2,
    )!;
    expect(restarted.agent_session_id).toBe("new-id");
    expect(restarted.lifecycle).toBe("live");
  });

  test("a resume reports the id the task already had", () => {
    const update = transitionFor(
      { hook_event_name: "SessionStart", source: "resume", session_id: SESSION_START.session_id },
      1,
    )!;
    expect(update.agent_session_id).toBe(SESSION_START.session_id);
  });

  test("an event we never registered moves nothing", () => {
    expect(transitionFor({ hook_event_name: "PreToolUse" }, 1)).toBeUndefined();
    expect(transitionFor({ hook_event_name: "SomethingNew" }, 1)).toBeUndefined();
    expect(transitionFor({}, 1)).toBeUndefined();
  });

  // A field rename in a future Claude Code must degrade to "no transition",
  // never to a throw inside the agent's own path.
  test("a payload missing everything it should have does not throw", () => {
    expect(() => transitionFor({ hook_event_name: "SessionStart" }, 1)).not.toThrow();
    const update = transitionFor({ hook_event_name: "SessionStart" }, 1)!;
    expect(update).not.toHaveProperty("agent_session_id");
    expect(update.lifecycle).toBe("live");
  });
});

describe("isHookPayload", () => {
  test("takes an object and nothing else", () => {
    expect(isHookPayload({ hook_event_name: "Stop" })).toBe(true);
    expect(isHookPayload([])).toBe(false);
    expect(isHookPayload(null)).toBe(false);
    expect(isHookPayload("Stop")).toBe(false);
    expect(isHookPayload(7)).toBe(false);
  });
});
