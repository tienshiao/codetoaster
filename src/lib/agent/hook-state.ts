import type { AgentState } from "../db";
import type { TaskUpdate } from "../tasks/store";

/** A hook payload, as far as we care about it. Everything is optional because
 * it arrives off a process we do not control: a future Claude Code is free to
 * rename a field, and the answer to that is to make no transition, not to
 * throw inside the agent's own path. */
export interface HookPayload {
  hook_event_name?: string;
  session_id?: string;
  transcript_path?: string;
  last_assistant_message?: string;
  /** SessionStart: startup | resume | clear | compact | fork.
   *  SessionEnd: clear | resume | logout | prompt_input_exit | other. */
  source?: string;
  reason?: string;
}

// SessionEnd is not the end of the task. `/clear` fires it on the old
// conversation and then a SessionStart with a new id (verified, §4.4), and a
// resume ends the old attachment the same way. Marking the task exited for
// either one flickers it through "dead" on every /clear — and strands it there
// for good if the SessionStart that should follow is dropped, reordered, or
// simply never sent by a future version. So only the reasons that mean the
// process is going away count. `other` is what the captured payload in §4.2
// carries for a real exit.
const ENDING_REASONS = new Set(["logout", "prompt_input_exit", "other"]);

/** The row change one payload implies, or undefined for anything that does not
 * move the task: an event we do not map, a SessionEnd that is not an ending,
 * a payload we cannot make sense of.
 *
 * Pure on purpose — the mapping in §4.2 is the part worth asserting against
 * the captured payloads, and it should be assertable without a database. */
export function transitionFor(payload: HookPayload, now: number = Date.now()): TaskUpdate | undefined {
  const state = (agentState: AgentState): TaskUpdate => ({ agent_state: agentState, last_active_at: now });

  switch (payload.hook_event_name) {
    case "SessionStart":
      return {
        // Overwritten rather than merged: `/clear` starts a new conversation
        // inside the same process, and the task's identity is ours — the
        // conversation id underneath it is free to change. A resume reports
        // the id it already had, so this is a no-op there.
        ...(payload.session_id ? { agent_session_id: payload.session_id } : {}),
        ...(payload.transcript_path ? { transcript_path: payload.transcript_path } : {}),
        // Two writes, not one. §4.2 says "state → live", but `live` is a
        // lifecycle: it is how a suspended task comes back when its agent
        // reports in. `idle` is the agent_state that goes with it — up, and
        // not working yet.
        ...state("idle"),
        lifecycle: "live",
        // Restamped, not inherited. This is an `idle` the harvester (TASK-15)
        // counts from, and the value sitting in the column belongs to the
        // conversation that just ended: a task that stopped hours ago and is
        // then `/clear`ed or resumed would come back live and idle already
        // past `harvest_after`, and be suspended out from under the user the
        // moment nobody is watching it. The session is idle as of now.
        idle_since: now,
      };

    case "UserPromptSubmit":
      return state("busy");

    case "Stop":
      return {
        ...state("idle"),
        // The card preview. Absent on a payload that carries no message,
        // rather than blanking what the task last said.
        ...(payload.last_assistant_message ? { last_message: payload.last_assistant_message } : {}),
        // What the idle harvester counts from (TASK-15).
        idle_since: now,
      };

    case "Notification":
      return state("needs_attention");

    case "PreCompact":
      return state("compacting");

    case "SessionEnd":
      return ENDING_REASONS.has(payload.reason ?? "") ? state("exited") : undefined;

    default:
      // An event we never registered, or one a future version added. Silence
      // is the whole contract here.
      return undefined;
  }
}

/** Whether a payload is worth handing to `transitionFor` at all. Separate so a
 * caller can tell "not for us" from "no change", which are different answers
 * even though both are a 2xx. */
export function isHookPayload(value: unknown): value is HookPayload {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
