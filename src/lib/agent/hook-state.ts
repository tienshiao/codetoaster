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
  /** PreCompact: manual | auto. The one field that says whether the agent was
   * mid-turn when compaction started, and so what it goes back to when the
   * compaction ends — see `compactTriggerOf`. */
  trigger?: string;
}

/** Why compaction started. `auto` means the context filled up in the middle of
 * a turn; `manual` means someone typed `/compact` at the prompt. */
export type CompactTrigger = "manual" | "auto";

// SessionEnd is not the end of the task. `/clear` fires it on the old
// conversation and then a SessionStart with a new id (verified, §4.4), and a
// resume ends the old attachment the same way. Marking the task exited for
// either one flickers it through "dead" on every /clear — and strands it there
// for good if the SessionStart that should follow is dropped, reordered, or
// simply never sent by a future version. So only the reasons that mean the
// process is going away count. `other` is what the captured payload in §4.2
// carries for a real exit.
const ENDING_REASONS = new Set(["logout", "prompt_input_exit", "other"]);

/** A field only if it really is a non-empty string. The interface above says
 * what we hope for; this is what holds at runtime, where the payload is an
 * unvalidated JSON object off a process we do not control. Without it a
 * `session_id` that arrives as a number or an object reaches TaskStore.update
 * as a bind value, bun:sqlite refuses it, and the throw turns "accepted,
 * changed nothing" into a 500 out of the hook route. */
function text(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/** PreCompact's trigger, when the payload is a PreCompact that names one.
 *
 * Read separately because the two ends of a compaction are two hooks: only
 * PreCompact carries the trigger, and only the `SessionStart` that follows can
 * decide what state the agent comes back in. Something has to hold it across
 * the gap, and that something is the caller — this function and
 * `endsCompaction` are the pair it brackets with. */
export function compactTriggerOf(payload: HookPayload): CompactTrigger | undefined {
  if (text(payload.hook_event_name) !== "PreCompact") return undefined;
  const trigger = text(payload.trigger);
  return trigger === "manual" || trigger === "auto" ? trigger : undefined;
}

/** Whether this payload is the `PreCompact` that *starts* a compaction,
 * whatever it says about why.
 *
 * The pair to `compactTriggerOf`, which cannot tell "not a PreCompact" from "a
 * PreCompact naming no trigger we know" — and the caller has to, because the
 * second one invalidates a trigger it is still holding. A compaction nobody
 * could characterise must come back unknowable, not wearing the last one's
 * answer. */
export function startsCompaction(payload: HookPayload): boolean {
  return text(payload.hook_event_name) === "PreCompact";
}

/** Whether this payload is the `SessionStart` that ends a compaction — the
 * point at which a held trigger is spent. */
export function endsCompaction(payload: HookPayload): boolean {
  return text(payload.hook_event_name) === "SessionStart" && text(payload.source) === "compact";
}

/** The row change one payload implies, or undefined for anything that does not
 * move the task: an event we do not map, a SessionEnd that is not an ending,
 * a payload we cannot make sense of.
 *
 * Pure on purpose — the mapping in §4.2 is the part worth asserting against
 * the captured payloads, and it should be assertable without a database. */
export function transitionFor(
  payload: HookPayload,
  now: number = Date.now(),
  /** The trigger of the compaction this payload ends, when it ends one and the
   * caller held it from the PreCompact. Absent means unknowable — a daemon that
   * restarted between the two — and is treated as it was before there was a
   * trigger at all: the SessionStart makes no claim about the agent's state. */
  compactTrigger?: CompactTrigger,
): TaskUpdate | undefined {
  const state = (agentState: AgentState): TaskUpdate => ({ agent_state: agentState, last_active_at: now });

  const sessionId = text(payload.session_id);
  const transcriptPath = text(payload.transcript_path);

  switch (text(payload.hook_event_name)) {
    case "SessionStart": {
      // A compact SessionStart is the far end of a compaction, and what the
      // agent comes back as depends entirely on which kind it was — which only
      // PreCompact said, hence `compactTrigger`.
      //
      // `auto` fires in the middle of a turn: the agent is still generating
      // when the rebuilt context arrives, so it goes back to `busy` and the
      // `Stop` that eventually lands ends the turn normally. Claiming `idle`
      // here would make the card read "done, waiting for you" for the rest of
      // the turn, and stamping `idle_since` early is exactly the miscount the
      // /clear restamp below exists to prevent — except here it would be the
      // harvester (TASK-15) suspending a task that never stopped working.
      //
      // `manual` is someone typing `/compact` at the prompt: nothing was in
      // flight, so the agent comes back idle and waiting, and nothing else
      // ever will say so. Leaving the `compacting` PreCompact set would strand
      // the task there for the rest of the session — wrong on the card, and
      // immortal to the harvester, which only ever collects `idle` tasks.
      const compacted = text(payload.source) === "compact";
      const afterCompaction: TaskUpdate =
        compactTrigger === "auto"
          ? { agent_state: "busy" }
          : compactTrigger === "manual"
            ? { agent_state: "idle", idle_since: now }
            : {};
      return {
        // Overwritten rather than merged: `/clear` starts a new conversation
        // inside the same process, and the task's identity is ours — the
        // conversation id underneath it is free to change. A resume reports
        // the id it already had, so this is a no-op there.
        ...(sessionId ? { agent_session_id: sessionId } : {}),
        ...(transcriptPath ? { transcript_path: transcriptPath } : {}),
        // Two writes, not one. §4.2 says "state → live", but `live` is a
        // lifecycle: it is how a suspended task comes back when its agent
        // reports in. Both halves hold however the session started, and
        // `last_active_at` holds too: something just reported in.
        lifecycle: "live",
        last_active_at: now,
        // `idle` is the agent_state that goes with a session that has come up
        // and is not working yet, and `idle_since` is restamped rather than
        // inherited: the value sitting in the column belongs to the
        // conversation that just ended, so a task that stopped hours ago and is
        // then `/clear`ed or resumed would come back live and idle already past
        // `harvest_after`, and be suspended out from under the user the moment
        // nobody is watching it. Neither applies to a compaction, which is why
        // both are conditional.
        ...(compacted ? afterCompaction : { agent_state: "idle" as AgentState, idle_since: now }),
      };
    }

    case "UserPromptSubmit":
      return state("busy");

    case "Stop":
      return {
        ...state("idle"),
        // The card preview. Absent on a payload that carries no message,
        // rather than blanking what the task last said.
        ...(text(payload.last_assistant_message)
          ? { last_message: text(payload.last_assistant_message) }
          : {}),
        // What the idle harvester counts from (TASK-15).
        idle_since: now,
      };

    case "Notification":
      return state("needs_attention");

    case "PreCompact":
      return state("compacting");

    case "SessionEnd":
      return ENDING_REASONS.has(text(payload.reason) ?? "") ? state("exited") : undefined;

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
