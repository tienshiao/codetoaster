import type { TaskRow } from "../db";
import type { ArchiveOutcome } from "../xtmux/types";

/** The lifecycle operations in flight on each task: the five maps that
 * serialize resume, suspend, evict, archive and unarchive against one another.
 * Only the maps. Each operation keeps its own wait-then-register code in the
 * method that runs it, and every lifecycle module holds this same instance.
 * Split out of TaskManager (TASK-152). */
export class InFlight {
  // The resume in flight for a task, if any. Resuming is what a client does on
  // the way to opening a task, so two of them can easily overlap — and the
  // whole ladder is awaited, so the "is it already running?" check in
  // `resumeTask` is separated from the spawn by several awaits. Without this, two concurrent
  // resumes both see no PTY and both start an agent on the same conversation
  // in the same directory, one of which is unreachable and never killed.
  readonly resuming: Map<string, Promise<TaskRow | undefined>> = new Map();
  // The mirror of `resuming`, and it has to exist for the same reason. Suspend
  // is not synchronous either: it awaits `snapshot`, which is a multi-hundred-KB
  // screen written to disk, and only *after* that does it kill the task's PTYs
  // and write `suspended`. A resume arriving inside that window saw a live,
  // unexited PTY and answered 200 with the ptyId of a terminal about to be
  // killed — or, where the agent had already exited, spawned a fresh one that
  // the suspend then killed along with the rest, leaving the user's close
  // silently undone by the ladder walking on.
  //
  // Each side registers its entry only *after* waiting on the other's, so the
  // two can never wait on each other — and each starts over once that wait is
  // done rather than carrying on, since the promise it waited on may have
  // handed straight to another one of the other kind.
  // `conditional` is whether this attempt may still refuse: a harvest re-checks
  // its caller's guards on the far side of the snapshot write and can walk
  // away, a close cannot. A joiner has to know, because adopting a harvest's
  // verdict would report a user's click as the no-op the *harvest* decided on.
  readonly suspending: Map<string, { done: Promise<boolean>; conditional: boolean }> = new Map();
  // The third of the same family, and it exists because `suspended` is not a
  // quiet state. An eviction takes a snapshot and then runs `git worktree
  // remove --force`, and a resume leaves the row `suspended` for its *whole*
  // run — the ladder only writes `live` on the rung that works — so a
  // lifecycle check alone lets the evict tier take the checkout out from under
  // a task somebody is in the middle of reopening: the directory the restore
  // just rebuilt and the agent was just spawned into. Registered before the
  // first await on the evict side and waited on before the ladder starts on
  // the resume side, so whichever gets there first is the one that runs.
  readonly evicting: Map<string, Promise<boolean>> = new Map();
  // The fourth of the family, and the one the task does not come back from
  // (§5.6). Archive is every other operation in sequence — it suspends, it
  // snapshots, it removes the checkout, it may delete the branch — so it needs
  // an entry of its own rather than borrowing one: two archives of a task would
  // both read `branchStatus` before either had destroyed anything, and the
  // second would then be describing, and acting on, a repository the first had
  // already emptied. Evict and resume wait on this for the reason they wait on
  // each other, and archive waits on an eviction in flight before registering,
  // so the two can never be waiting on one another.
  readonly archiving: Map<string, Promise<ArchiveOutcome | null>> = new Map();
  // The fifth, and archive's way back (TASK-139). It recreates a branch and
  // then hands over to the resume ladder, and both halves need fencing: two
  // unarchives would both see the branch missing and race to recreate it, and
  // an archive landing between the lifecycle flip and the ladder would remove a
  // checkout the ladder is about to rebuild. A second unarchive joins this one;
  // an archive waits for it before registering, and this waits for an archive
  // before registering, so the two can never be waiting on each other.
  readonly unarchiving: Map<string, Promise<TaskRow | undefined | null>> = new Map();
}
