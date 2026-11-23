import {
  compactTriggerOf,
  endsCompaction,
  startsCompaction,
  transitionFor,
  type CompactTrigger,
  type HookPayload,
} from "../agent/hook-state";
import type { TaskHost } from "./host";

/** What an agent's hooks say about its task (§4.2), and what is held between
 * them: whether the running agent has reported at all, and a compaction in
 * flight. Split out of TaskManager (TASK-152). */
export class TaskHooks {
  // Set by a PreCompact, read and dropped by the SessionStart that ends the
  // same compaction. In memory rather than on the row because it is only ever
  // live for the seconds between the two, and a daemon that restarts across
  // that gap has killed the agent that would have sent the second half.
  private compactTriggers: Map<string, CompactTrigger> = new Map();
  // Held across the same gap, for the same reason: a `/compact` typed while a
  // background agent is still running (TASK-145). The compaction's far end
  // says nothing about background work, so without this a manual compaction
  // would come back `idle` and be harvested with the background agent mid-run.
  private compactingFromBackground: Set<string> = new Set();
  // Which tasks have ever reported a hook, and the timers waiting to find out
  // (§9, risk 4). Both in memory on purpose: what they guard is a running
  // PTY's output activity, which is per-process by definition. A task with no
  // live PTY has no heuristic to fall back to, so a flag that does not survive
  // a restart is not missing anything — and a resumed task genuinely is
  // unknown again until its agent reports in.
  // The timers are `hookGraceTimers`, in activity.ts.
  private hookSeen: Set<string> = new Set();

  constructor(private readonly host: TaskHost) {}

  /** Whether the task's running agent has reported a hook. */
  hasSeenHook(taskId: string): boolean {
    return this.hookSeen.has(taskId);
  }

  /** Forget what the task's agent process has reported: that it reported at
   * all, and a compaction it was in the middle of. Every site that drops one
   * of these drops all three — a new spawn, a discarded rung, a suspend, a
   * delete — because all three are about a process, not about the task. */
  forgetAgentProcess(taskId: string): void {
    this.hookSeen.delete(taskId);
    this.compactTriggers.delete(taskId);
    this.compactingFromBackground.delete(taskId);
  }

  /** Apply one hook payload to a task (§4.2). False when there is no such
   * task or the payload moves nothing — both of which the caller answers 2xx,
   * since a hook that reports a problem reports it into the agent's own
   * transcript. */
  applyHook(taskId: string, payload: HookPayload): boolean {
    if (!this.host.store.get(taskId)) return false;
    // Recorded before the mapping runs, and for any payload at all: what this
    // says is "the hooks are wired up", which a payload we do not map answers
    // just as well as one we do. From here the heuristic stays out of the way.
    //
    // The *first* one is also the moment the setup wrapper's stamp is known to
    // be on disk, because the wrapper only execs the agent once setup has
    // exited zero and only an agent that loaded our settings sends a hook. So
    // the reading is hung here rather than on a timer, and only on the edge —
    // a task reports hundreds of these.
    if (!this.hookSeen.has(taskId)) {
      this.hookSeen.add(taskId);
      // Caught for the same reason every other fire-and-forget here is:
      // `applyHook` is synchronous and answers a live HTTP request, so a
      // rejection travelling out of this has no caller left to reach and
      // becomes an unhandled one. Nothing downstream needs the reading — its
      // only consumer is the eviction grace scale, days later.
      void this.host.recordSetupOutcome(taskId).catch(() => {});
    }
    this.host.disarmHookGrace(taskId);
    // A compaction is two hooks: PreCompact names the trigger, and the
    // SessionStart that ends it is the one that has to decide what the agent
    // comes back as. Nothing in the second payload says which kind it was, so
    // the trigger is held here between them and spent on arrival.
    // Held per compaction, not per task: every PreCompact replaces what was
    // there, including one that names no trigger. A compaction whose first half
    // said nothing is unknowable, and the previous compaction's answer — from
    // one that was cancelled, or whose SessionStart never arrived — is a guess
    // dressed as a fact, which is the one thing the `undefined` road exists to
    // avoid.
    const trigger = compactTriggerOf(payload);
    if (startsCompaction(payload)) {
      if (trigger) this.compactTriggers.set(taskId, trigger);
      else this.compactTriggers.delete(taskId);
      if (this.host.store.get(taskId)?.agent_state === "background") this.compactingFromBackground.add(taskId);
      else this.compactingFromBackground.delete(taskId);
    }
    const ending = endsCompaction(payload);
    const update = transitionFor(
      payload,
      Date.now(),
      ending ? this.compactTriggers.get(taskId) : undefined,
    );
    // A manual compaction comes back `idle`, which is only true if nothing
    // was left running behind the turn before it. The background work the
    // last `Stop` reported is still going, so it comes back as that.
    if (ending && update?.agent_state === "idle" && this.compactingFromBackground.has(taskId)) {
      update.agent_state = "background";
    }
    if (ending) {
      this.compactTriggers.delete(taskId);
      this.compactingFromBackground.delete(taskId);
    }
    if (!update) return false;
    // `SessionStart` claims the task is live, and for a task with a terminal it
    // is. But `codetoaster hook` outlives the agent that spawned it — killing
    // the PTY does not signal it — so one can land just after `suspendTask`
    // killed everything, and taking its word would leave a row marked `live`
    // with `ptyId: null`: a task the sidebar shows as running that nothing is
    // behind, and whose freshly stamped `idle_since` keeps the harvester off it
    // for a full `harvestAfterMs`. The rest of the transition still applies —
    // it is only the claim about liveness that needs a process to back it.
    if (update.lifecycle === "live" && !this.host.primaryPty(taskId)) {
      delete update.lifecycle;
    }
    if (!this.host.store.update(taskId, update)) return false;
    this.host.broadcastTask(taskId);
    // A finished turn is the moment the working tree can have moved: the agent
    // has stopped editing, and what it did is exactly what the card is
    // reporting. This is the primary freshness mechanism and the reason the
    // backstop's TTL can be minutes — measuring on a timer would be both later
    // and more often than measuring here.
    //
    // Not awaited. The hook route answers a running agent, and five git
    // processes must not sit on that reply; `refreshWorktreeStatus` broadcasts
    // for itself when the answer differs from the last one.
    if (update.agent_state === "idle" || update.agent_state === "background") {
      void this.host.refreshWorktreeStatus(taskId, { force: true });
    }
    return true;
  }
}
