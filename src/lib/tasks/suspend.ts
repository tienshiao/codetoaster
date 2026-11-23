import * as fs from "fs";
import type { TaskRow } from "../db";
import {
  applyWip,
  dropWip,
  evictWorktree,
  restoreWorktree,
  snapshotWip,
  worktreePathFor,
  WorktreeError,
  type RestoredWorktree,
  type WipSnapshot,
} from "../worktree";
import type { TaskHost } from "./host";
import type { InFlight } from "./inflight";
import { removeSnapshot, writeSnapshot } from "./snapshot";

/** Putting a task down and taking its checkout back off disk (§5.5, §5.6):
 * the screen snapshot, suspend and harvest, eviction, the WIP snapshot that
 * makes eviction safe, the decision a refused snapshot leaves the user, and
 * the restore that rebuilds the checkout. Split out of TaskManager
 * (TASK-152). */
export class TaskSuspension {
  constructor(
    private readonly host: TaskHost,
    private readonly inflight: InFlight,
  ) {}

  /** Write the task's screen to disk and record the grid it was at (§5.1).
   * False when there was nothing to write.
   *
   * What TASK-15's harvester calls before it kills an idle agent's terminal,
   * and what TASK-17's restore reads back. The size goes on the row in the same
   * breath because the two are one fact: a snapshot repainted into a grid it
   * was not taken at reflows into nonsense, and `runResumeLadder` already reads
   * `last_size_*` to size the terminal it spawns.
   *
   * A task with no live terminal keeps whatever snapshot it already has rather
   * than having it cleared. The file is only stale in the sense that the
   * process behind it is gone, which is precisely when a user wants to see it;
   * reconciling rows whose PTYs died with the daemon is `reconcileOnBoot`'s
   * job.
   *
   * It never throws. The harvester runs this across every live task on a timer,
   * so one task whose directory has been deleted under it must not take the
   * rest of the tick down with it. */
  async snapshot(taskId: string): Promise<boolean> {
    if (!this.host.store.get(taskId)) return false;
    const pty = this.host.primaryPty(taskId);
    if (!pty) return false;
    // The screen and the grid it was taken at, read together, because they are
    // one fact: a snapshot repainted into a grid it was not taken at reflows
    // into nonsense. Reading the size after the write would let them disagree —
    // the write is queued behind any earlier one for this task, and in that
    // window a client detaching or resizing re-runs smallest-wins and changes
    // the PTY's grid under us. The row would then claim the new size for a
    // screen serialized at the old one.
    const screen = pty.serialize();
    const size = pty.getSize();
    // A screen with nothing on it is nothing to write, not an empty screen.
    // `serialize` answers "" once the terminal is disposed, so that a stray call
    // cannot throw out of the harvester's tick — and a live terminal that has
    // painted nothing answers exactly the same, which is a second or two of
    // every resume: close the task between the spawn of `claude` and the agent's
    // first paint and this runs against a terminal with an empty buffer.
    // Persisting either "" would overwrite the last screen the task ever
    // painted, which is the opposite of what the no-PTY branch above is careful
    // to preserve — so both stop here, before the write and before the row is
    // told a size, since a `last_size_*` recorded for a screen that was never
    // written describes the screen that is still on disk.
    if (!screen) return false;
    try {
      await writeSnapshot(taskId, screen);
    } catch (e) {
      console.warn(`Could not write scrollback snapshot for task ${taskId}:`, e);
      return false;
    }
    // The task can be deleted while the write is in flight, and `deleteTask`
    // fires its own removal without awaiting it — so the removal can run first
    // and this write lands after it, recreating the directory and leaving a
    // multi-hundred-KB file for a row that no longer exists and an id that can
    // never be reissued. Exactly the leak the removal exists to prevent.
    if (!this.host.store.get(taskId)) {
      void removeSnapshot(taskId).catch(() => {});
      return false;
    }
    this.host.store.update(taskId, { last_size_cols: size.cols, last_size_rows: size.rows });
    return true;
  }

  /** Harvest a task: put the screen on disk, kill everything running behind
   * it, and leave the row saying so (§5.5). False for a task that is not there
   * or is not live — a suspended task has nothing left to take away, and
   * asking twice is something both the harvester's tick and a user's click can
   * do.
   *
   * This is the whole of what harvesting *does*; whether a given task should be
   * harvested is the caller's question. The idle harvester answers it with §5.5's
   * guards and `closeTask` answers it with a click, and neither one belongs in
   * here.
   *
   * The snapshot comes first, and the order is load-bearing: `Pty.kill`
   * disposes the headless terminal, `serialize` answers "" from then on, and
   * `snapshot` refuses to persist that — so a snapshot taken after the kill
   * would silently leave the task with whatever screen it had before this one,
   * which is exactly the screen the user is about to be shown when they reopen
   * it (§5.5, phase 1).
   *
   * The row and `~/.codetoaster/tasks/<id>/` both stay. Suspension is the
   * reversible level of gone (§5.6): the settings file is what the resumed
   * agent is started with, and the scrollback we just wrote is what the user
   * sees while it comes back. */
  suspendTask(taskId: string): Promise<boolean> {
    return this.putDown(taskId, undefined);
  }

  /**
   * Harvest a task, unless `stillHarvestable` has stopped being true by the
   * time it can actually be acted on.
   *
   * The guards stay the caller's, exactly as `suspendTask` says they must —
   * this does not learn what idle means. What it adds is the one moment the
   * caller cannot reach: `doSuspend` awaits a snapshot write before it kills
   * anything, that write is queued behind any earlier one for the task, and a
   * WebSocket attach serviced in that window is answered `attached`/`restore`
   * by a daemon that then kills the terminal out from under it. The harvester
   * re-checks its own guards either side of its `ps` (`shouldHarvest`), but the
   * window it cannot see from there is this one, on the inside of the call it
   * has already made.
   *
   * So the predicate is asked once more, as late as it can be: after the screen
   * is safely on disk, immediately before the first `kill`.
   */
  harvestTask(taskId: string, stillHarvestable: () => boolean): Promise<boolean> {
    return this.putDown(taskId, stillHarvestable);
  }

  private async putDown(
    taskId: string,
    stillHarvestable: (() => boolean) | undefined,
  ): Promise<boolean> {
    // A resume in flight has to settle first. The ladder leaves the row
    // `suspended` for its whole run and only writes `live` on the rung that
    // works, so a close arriving mid-resume read "not live", answered false and
    // did nothing at all — and seconds later the ladder finished, wrote `live`
    // and handed the user back the agent they had just closed. The route
    // reported success either way, so there was nothing to say it had happened.
    // Waiting means the click lands on the task the resume produced, which is
    // the task the user was looking at when they clicked.
    const inFlight = this.inflight.resuming.get(taskId);
    if (inFlight) {
      await inFlight.catch(() => undefined);
      // Started over rather than fallen through, because settling that resume
      // is not the same as there being no resume. A `fresh` caller parks on the
      // very same promise and registers a *new* ladder the instant it settles —
      // and it registered its continuation before this one, so by the time we
      // get here the second ladder is already in `resuming`. Falling through
      // would run `doSuspend` alongside it: it reads a row still marked `live`,
      // takes no snapshot and kills nothing (the fresh start discarded the
      // PTYs), writes `suspended` and reports success — and then the ladder
      // writes `live` again, leaving an agent running on a task the user
      // closed. Asking again is the whole fix: the click lands on the task the
      // *last* resume produced.
      return this.putDown(taskId, stillHarvestable);
    }
    // Registered only now, on the far side of that wait, so a resume waiting on
    // us and a suspend waiting on it can never be waiting on each other. A
    // second close joins the first rather than snapshotting the task twice.
    const alreadySuspending = this.inflight.suspending.get(taskId);
    if (alreadySuspending) {
      // A close cannot adopt a harvest's verdict. The harvest may be about to
      // refuse on a guard the close does not have — and the commonest way for
      // that to happen is the user attaching, which is exactly what someone
      // who then clicks close has just done. Joining would answer their click
      // with the harvest's `false` and leave the task live. So this waits it
      // out and asks again, the way a suspend already waits out a resume.
      //
      // Every other pairing joins: a harvest behind anything is getting the
      // suspension it wanted, and a close behind a close is the same click
      // twice.
      if (alreadySuspending.conditional && !stillHarvestable) {
        await alreadySuspending.done.catch(() => undefined);
        return this.putDown(taskId, stillHarvestable);
      }
      return alreadySuspending.done;
    }
    const done = this.doSuspend(taskId, stillHarvestable).finally(() => {
      this.inflight.suspending.delete(taskId);
    });
    this.inflight.suspending.set(taskId, { done, conditional: stillHarvestable !== undefined });
    return done;
  }

  private async doSuspend(
    taskId: string,
    stillHarvestable?: () => boolean,
  ): Promise<boolean> {
    const row = this.host.store.get(taskId);
    if (!row || row.lifecycle !== "live") return false;
    await this.host.snapshot(taskId);
    // The last possible moment, and the only one that closes the window: the
    // write above is queued behind any earlier one for this task, so it can
    // take as long as a multi-hundred-KB screen takes to reach the disk, and
    // the daemon services WebSocket attaches throughout. A user who clicked
    // this task in that window has already been sent `attached` and `restore`.
    //
    // Walking away leaves the snapshot on disk, deliberately: it is the screen
    // the task really had, the task stays live, and the next tick will write
    // another. Nothing was killed, which is the whole point.
    if (stillHarvestable && !stillHarvestable()) return false;
    // Every terminal the task holds, not just the agent's: a shell tab
    // (TASK-27) is a process in the task's directory like any other, and §5.5
    // harvests the task, not one of its processes.
    //
    // Their kill-time edges run no handler (`unmapAndKill`), and nothing here
    // needs them. The busy dot is `taskStateOf`, where a `suspended` lifecycle
    // wins over whatever `agent_state` says, so the delta below puts it out;
    // and a hookless agent's inferred `busy` is overwritten with `starting` by
    // the resume that next spawns one.
    this.host.unmapAndKill(taskId, this.host.taskPtyIds(taskId));
    this.host.forgetTaskPtys(taskId);
    this.host.forgetAgentPty(taskId);
    // What a task without a process cannot have: a clock waiting for an agent's
    // first hook, which would wake up and relabel a task that is deliberately
    // quiet; a record that the agent now gone had reported, which is a claim
    // about a process, not about a task (`spawnAgent` clears it for the same
    // reason on the way back); and a throttle timestamp for a cwd check that
    // was performed against a terminal that no longer exists, which would
    // otherwise suppress the first check after the task is resumed.
    this.host.disarmHookGrace(taskId);
    this.host.forgetAgentProcess(taskId);
    this.host.forgetCwdCheck(taskId);
    // And the claim that the process now gone was a restart, which is about
    // that process and not about the suspended task the next reopen judges.
    this.host.clearRestarted(taskId);
    // Only the lifecycle. `agent_state` stays `idle` (or `background`, for a
    // task the harvester took at its cap): that is what was true of the agent
    // when it was harvested and what the card should go on saying.
    // `reconcileOnBoot`'s `unknown` is the other case — a daemon that never
    // witnessed its agents die and cannot speak for what they were doing.
    this.host.store.update(taskId, { lifecycle: "suspended" });
    this.host.broadcastTask(taskId);
    return true;
  }

  /** Closing a task. Chat products have no "close", and neither does this one:
   * §6 makes the close button a suspend, and archive (TASK-31) the only way a
   * task truly leaves.
   *
   * It is `suspendTask` and nothing else on purpose. Manual close is the
   * harvest path minus the guards — §5.5's own wording — so the two must not be
   * able to drift: whatever harvesting learns to preserve, a user's click
   * preserves too. The guards are the entire difference, and they live with the
   * caller that has a reason to ask: the harvester answers "should this be
   * harvested?" with §5.5, and a click answers it by being a click. */
  closeTask(taskId: string): Promise<boolean> {
    return this.host.suspendTask(taskId);
  }

  /** The repository a task's checkout belongs to.
   *
   * Off the row, and the row is the point (TASK-64): every worktree operation
   * used to find the repository through the *project*, and deleting a project
   * reassigns its tasks to General — whose path is empty — leaving a task that
   * could neither be reopened nor evicted, its branch and its snapshot sitting
   * in a repository nothing could name.
   *
   * A null heals rather than failing: a task created before the column existed
   * still has a project to ask, so the answer is resolved once and written
   * back. Only a task that has *already* lost its project can end with nothing,
   * and that is the one case with no recovery — the path it was branched from
   * was never recorded and the project that knew it is gone. */
  async repoRootFor(row: TaskRow): Promise<string | null> {
    const root = await this.host.resolveRepoRoot(row);
    if (root && !row.worktree_repo && this.host.store.get(row.id)) {
      this.host.store.update(row.id, { worktree_repo: root });
    }
    return root;
  }

  /** What a task's outstanding snapshot decision is, or null when it owes none.
   *
   * The pair of columns, resolved once: a *present* checkout that still has a
   * WIP ref is a snapshot `restoreWorktree` refused to apply because the branch
   * had moved under it. Both actions below need exactly this, and both have to
   * refuse the same states — an evicted task's ref is how it is stored, not a
   * decision, and a checkout that is not on disk has nothing to apply into. */
  private pendingWip(taskId: string): { ref: string; worktreePath: string } | null {
    // Not while an eviction is running. `doEvict` writes the ref through
    // `snapshotTaskWip` and only *then* removes the checkout, so for the whole
    // of `git worktree remove` the row reads exactly like a refused snapshot —
    // `present`, with a `wip_ref` — and a discard landing in that window drops
    // the one commit the eviction is relying on. The checkout and the snapshot
    // would both be gone, which is the single way this design can lose work.
    // Refused rather than queued: the eviction finishes in a moment and clears
    // the state that made the question look outstanding.
    if (this.inflight.evicting.has(taskId)) return null;
    // Nor while an archive is running, which is the same window seen from the
    // other end: `doArchive` snapshots through `snapshotTaskWip` and only then
    // removes the checkout, so for the whole of that removal the row reads
    // `present` with a `wip_ref` too — and a discard landing there drops the
    // commit the archive's whole recoverability rests on, moments before the
    // directory holding the other copy goes.
    if (this.inflight.archiving.has(taskId)) return null;
    const row = this.host.store.get(taskId);
    if (!row?.wip_ref || !row.worktree_path) return null;
    if (row.worktree_state !== "present") return null;
    if (!fs.existsSync(row.worktree_path)) return null;
    return { ref: row.wip_ref, worktreePath: row.worktree_path };
  }

  /** Take the user up on a snapshot the restore refused (§5.6).
   *
   * This is the destructive arm of the three, and deliberately so: the checkout
   * has been sitting there since the restore, possibly worked in, and applying
   * writes the snapshot's version of every file it holds over what is there
   * now. The confirmation belongs to the caller — the server cannot know
   * whether the user has read what they are about to lose — but the *decision*
   * is theirs to make, so nothing here second-guesses it once it has been made.
   *
   * The ref is dropped afterwards rather than kept as a spare copy, for the
   * reason an applied restore drops it: `wip_ref` on a present checkout is what
   * "owes a decision" is spelled as, and one that survived the decision would
   * ask the question again forever. */
  async applyTaskWip(taskId: string): Promise<boolean> {
    const pending = this.pendingWip(taskId);
    if (!pending) return false;
    await applyWip(pending.worktreePath, pending.ref);
    await dropWip(pending.worktreePath, taskId);
    if (!this.host.store.get(taskId)) return true;
    this.host.store.update(taskId, { wip_ref: null, wip_at: null });
    this.host.broadcastTask(taskId);
    return true;
  }

  /** Throw the snapshot away, and stop asking.
   *
   * The one genuinely irreversible thing in the worktree module: nothing else
   * points at the commit, and `refs/codetoaster/*` gets no reflog, so the
   * objects are collectable the moment the ref is gone. It is still the right
   * default to offer — the alternative is a card that cannot be dismissed —
   * and the third choice, keeping the ref and answering later, costs nothing
   * and is what a user who is unsure should take. */
  async discardTaskWip(taskId: string): Promise<boolean> {
    // Its own guard rather than `pendingWip`, and the difference is the
    // checkout. Applying writes files into a directory and so needs one on
    // disk; dropping a ref needs only the repository, which the row can name
    // by itself now. Without this, a task whose checkout was removed by hand
    // shows a notice neither button can clear — and its ref would go on
    // keeping it from ever being evicted again.
    //
    // Still only for a *present* checkout: an evicted task's ref is how its
    // work is stored rather than a decision, and discarding that destroys it.
    if (this.inflight.evicting.has(taskId)) return false;
    // Nor mid-archive, and this is the arm that pair of guards exists for.
    // `pendingWip` withholding the question stops the *notice* being drawn, but
    // a discard is a POST that can already be in flight when the archive
    // starts — and unlike apply it does not go through `pendingWip`, because
    // dropping a ref needs only the repository. So without this it lands on the
    // one commit the archive's recoverability rests on, moments before the
    // checkout holding the other copy goes, and there is no third copy.
    if (this.inflight.archiving.has(taskId)) return false;
    const row = this.host.store.get(taskId);
    if (!row?.wip_ref || row.worktree_state !== "present") return false;
    const repoRoot = await this.host.repoRootFor(row);
    if (!repoRoot) return false;
    await dropWip(repoRoot, taskId);
    if (!this.host.store.get(taskId)) return true;
    this.host.store.update(taskId, { wip_ref: null, wip_at: null });
    this.host.broadcastTask(taskId);
    return true;
  }

  /** Take a suspended task's checkout off disk, keeping everything that makes
   * it rebuildable (§5.6).
   *
   * The second tier of harvesting. Suspending gives back the processes; this
   * gives back the disk, and it is safe to do to a dirty tree because the
   * snapshot goes first and the branch is never touched. What is left is a row,
   * a branch and a WIP ref — enough for `restoreTaskWorktree` to put the task
   * back exactly as it was.
   *
   * **Only on a suspended task**, and that is the guard that discharges every
   * other one. A live task has processes in that directory: an agent mid-turn,
   * a build in a shell tab, an editor with unsaved work. Removing the checkout
   * under them is not recoverable in the way this otherwise is, and the
   * harvester's own is-anything-running guards have already been passed by
   * anything that reached `suspended`. A manual evict is refused for the same
   * reason rather than being allowed to override it: the caller should close
   * the task first, which is one click and has its own snapshot.
   *
   * **Never without a snapshot.** `snapshotTaskWip` answering null is always a
   * reason to keep the directory — there is nothing recorded to restore from,
   * or there is a snapshot already waiting on the user's decision that a new
   * one would overwrite. Eviction is only ever as safe as the snapshot that
   * preceded it, so no snapshot means no eviction.
   *
   * **Never against a resume in flight.** `suspended` is not a quiet state: the
   * ladder leaves the row saying it for its entire run and only writes `live`
   * on the rung that works, so the lifecycle guard above passes for a task
   * somebody is in the middle of reopening — and what would then be removed is
   * the directory the restore just rebuilt, with the agent already spawned into
   * it. Refused rather than queued behind it: the next sweep is thirty seconds
   * away, and by then the resume has either landed (live, so not evictable) or
   * failed (suspended again, and evictable on its own merits).
   *
   * Whether a task *should* be evicted — grace, pins — is the harvester's, the
   * same way `suspendTask` knows nothing about idle timeouts. */
  evictTask(taskId: string): Promise<boolean> {
    if (this.inflight.resuming.has(taskId)) return Promise.resolve(false);
    // And not against an archive either, for a sharper version of the same
    // reason: archive is already removing this checkout and is between reading
    // the branch status and acting on it. A second remover would either lose
    // the race harmlessly or win it and leave archive's `branchStatus` — taken
    // moments ago, and about to decide whether a branch is deleted — describing
    // a repository that has changed underneath it.
    if (this.inflight.archiving.has(taskId)) return Promise.resolve(false);
    // Nor against an unarchive, which is about to rebuild this checkout. The
    // row reads `suspended` + `evicted` from its lifecycle flip until the
    // ladder's restore, so `doEvict` would refuse anyway — this says so at the
    // door, rather than relying on which await the unarchive happens to be in.
    if (this.inflight.unarchiving.has(taskId)) return Promise.resolve(false);
    // A second caller joins the first rather than snapshotting and removing the
    // same checkout twice — the manual route and the evict tier can easily
    // arrive together.
    const already = this.inflight.evicting.get(taskId);
    if (already) return already;
    // Registered before the first await, so a resume that checks this map
    // cannot slip past between the guard above and the work below.
    const attempt = this.doEvict(taskId).finally(() => {
      this.inflight.evicting.delete(taskId);
    });
    this.inflight.evicting.set(taskId, attempt);
    return attempt;
  }

  private async doEvict(taskId: string): Promise<boolean> {
    const row = this.host.store.get(taskId);
    if (!row?.worktree_path || row.worktree_state !== "present") return false;
    if (row.lifecycle !== "suspended") return false;

    const repoRoot = await this.host.repoRootFor(row);
    // Nothing to evict *into* a repository we cannot name. Refusing keeps the
    // directory, which is the safe half — the task is broken either way, and
    // TASK-64's failure message on the reopen path is where it gets explained.
    if (!repoRoot) return false;

    const snapshot = await this.host.snapshotTaskWip(taskId);
    if (!snapshot) return false;

    await evictWorktree(repoRoot, row.worktree_path);
    // `discardCheckout` is best-effort by design — it falls back to an `rm` git
    // refused and swallows that too — so a removal can resolve having removed
    // nothing. The row must not then say `evicted`: the restore stops at
    // `assertPathFree` *before* it prunes, and the path is fixed by the task's
    // id and cannot be moved away from, so a directory that survived would make
    // the task unreopenable for good. Left `present`, which is what is true.
    if (fs.existsSync(row.worktree_path)) {
      console.warn(`Could not remove the checkout of task ${taskId}; it stays present`);
      return false;
    }
    // Re-read rather than trusted: the snapshot and the removal are two awaits,
    // and a task deleted across them must not be written back as a row holding
    // one column.
    if (!this.host.store.get(taskId)) return true;
    // `worktree_path` is deliberately kept. It is derived from the task's id
    // and is where the restore will rebuild — forgetting it would make an
    // evicted task indistinguishable from one that never had a checkout.
    this.host.store.update(taskId, { worktree_state: "evicted" });
    this.host.broadcastTask(taskId);
    return true;
  }

  /** Evict every suspended task of a project, and answer how many went.
   *
   * Sequential rather than parallel: every eviction in one repository takes the
   * same per-repo lock, so a `Promise.all` would queue on it anyway while
   * making a single failure harder to attribute. One that throws does not stop
   * the rest — a project reclaimed except for the one checkout git refused is
   * the useful outcome. */
  async evictProject(projectId: string): Promise<number> {
    let evicted = 0;
    for (const row of this.host.store.list({ lifecycle: "suspended" })) {
      if (row.project_id !== projectId) continue;
      try {
        if (await this.host.evictTask(row.id)) evicted++;
      } catch (e) {
        console.warn(`Could not evict task ${row.id}:`, e);
      }
    }
    return evicted;
  }

  /** Commit a task's working state to its WIP ref, and record it on the row
   * (§5.6).
   *
   * The half of eviction that has to be safe. Removing the checkout is trivial
   * and reversible; what makes it reversible is that this ran first and
   * succeeded, so the evict tier calls it and only proceeds on a snapshot it
   * got back. Nothing here decides *whether* to evict — the grace period, the
   * pin, the manual trigger are all the caller's (TASK-39).
   *
   * Answers `null` when there is nothing to snapshot, or nothing that may
   * safely be overwritten: a task with no checkout of its own runs in the
   * project's directory, where the working state is the user's and not ours to
   * commit; a task whose checkout is already gone has only what a previous
   * snapshot saved; and a task still holding a refused snapshot owes the user a
   * decision that a second snapshot would answer for them. None is a failure,
   * and all are states the caller would otherwise have to test for itself.
   *
   * A git failure throws. The live tree is untouched either way — the snapshot
   * works through a throwaway index — so a caller that treats a throw as "do
   * not evict this one" loses nothing but a turn. */
  async snapshotTaskWip(taskId: string): Promise<WipSnapshot | null> {
    const row = this.host.store.get(taskId);
    if (!row?.worktree_path || row.worktree_state !== "present") return null;
    // `present` is a claim about a directory, and the directory can be gone —
    // the same distrust `restoreTaskWorktree` reads the column with. Without
    // this the snapshot throws `snapshot-failed` on a task there is nothing to
    // snapshot for, and a caller that reads a throw as "do not evict this one"
    // would keep retrying a checkout that is already off the disk.
    if (!fs.existsSync(row.worktree_path)) return null;
    // A ref already on the row of a *present* checkout is the needs-decision
    // state and nothing else: a snapshot `restoreWorktree` refused to apply,
    // still waiting on apply / keep / discard. A task has one WIP ref, and
    // `snapshotWip` moves it — so snapshotting now would leave the refused
    // commit unreachable and take the user's choice away on their behalf, in
    // the middle of an eviction they never asked for. Null keeps the checkout,
    // since the caller only evicts on a snapshot it got back.
    if (row.wip_ref) return null;

    const snapshot = await snapshotWip({ id: taskId, worktreePath: row.worktree_path });
    // Checked on the far side of the await, like every other write here: a task
    // deleted while git was working would otherwise be resurrected as a row
    // holding two columns. The ref outlives it, which archive's retention sweep
    // is the right place to notice — not a write that recreates the task.
    if (!this.host.store.get(taskId)) return snapshot;
    this.host.store.update(taskId, { wip_ref: snapshot.ref, wip_at: snapshot.at });
    this.host.broadcastTask(taskId);
    return snapshot;
  }

  /** Rebuild a checkout that was evicted or removed behind our back, and put
   * the task's work back in it (§5.6).
   *
   * What opening an evicted task runs before the agent is resumed. Answers
   * `null` when there is nothing to restore — a task that never had a checkout,
   * or one whose checkout is still on disk — so the open path can call it
   * unconditionally rather than reading `worktree_state` itself.
   *
   * **`wip_ref` surviving a restore is what "needs a decision" is spelled as.**
   * On a clean round trip the snapshot is applied and the columns are cleared:
   * the work is on disk, and the next eviction will write a fresh ref anyway.
   * When the branch moved while the task was evicted, `restoreWorktree` refuses
   * to apply it and the columns stay — so `worktree_state = present` with a
   * `wip_ref` still set is, durably and without a new column, the task whose
   * card owes the user an apply / keep / discard. It survives a daemon restart
   * for the same reason, which a flag held in memory would not. */
  async restoreTaskWorktree(taskId: string): Promise<RestoredWorktree | null> {
    const row = this.host.store.get(taskId);
    if (!row?.branch || row.worktree_state === "none") return null;
    // `present` is a claim about a directory, and a directory can be removed by
    // someone who never told us. Trusting the column would answer "nothing to
    // do" for exactly the task whose terminal is about to open on a path that
    // is not there.
    if (row.worktree_state === "present" && row.worktree_path
        && fs.existsSync(row.worktree_path)) {
      return null;
    }

    const repoRoot = await this.host.repoRootFor(row);
    if (!repoRoot) {
      // The task was branched from a repository nobody recorded, and the
      // project that knew which one is gone. Its own kind rather than
      // `not-a-repo`, because the two ask for different things: `not-a-repo`
      // means "that directory is not a repository", which the user can fix by
      // pointing at one, while this means "we have lost track of yours" — and
      // the message has to say that the work is not lost with it.
      throw new WorktreeError(
        "repo-unknown",
        `Task "${row.title}" was branched from a repository this task can no longer name — `
          + `its project was removed. Its work is still on branch ${row.branch}.`,
      );
    }
    const project = this.host.projects.find((p) => p.id === row.project_id);
    const restored = await restoreWorktree(
      {
        root: repoRoot,
        // Read now rather than remembered from the create: a project's copy
        // list is editable, and a restore should produce the checkout the
        // project asks for today. Null once the project is gone, which is
        // right — there is no list to honour.
        worktreeCopy: project?.worktreeCopy ?? null,
      },
      {
        id: taskId,
        branch: row.branch,
        // From the row. A task reassigned to another project would have the
        // id-derived path answer with a different directory from the one it was
        // evicted from, and the restore would rebuild beside the work.
        worktreePath: row.worktree_path ?? worktreePathFor(row.project_id, taskId),
        // From the row for the same reason, and read as `''` when it is not
        // there: a task created before the column existed worked at the root of
        // its checkout, which is what an empty offset says.
        subdir: row.worktree_subdir ?? "",
      },
    );
    // Dropped along with the columns that record it, and not left as a spare
    // copy. The work is on disk now, so the ref holds nothing the checkout does
    // not — but it outlives the row's account of it, and `restoreWorktree`
    // reads git rather than the row: the *next* restore of this task, after a
    // directory removed by hand or a daemon that died mid-restore, would find
    // the old ref and apply work the row says was consumed. That undoes, among
    // other things, a `git restore .` the user ran deliberately once the last
    // restore handed it back to them.
    if (restored.wip === "applied") await dropWip(restored.worktreePath, taskId);
    if (!this.host.store.get(taskId)) return restored;
    this.host.store.update(taskId, {
      worktree_state: "present",
      worktree_path: restored.worktreePath,
      // The agent runs in its checkout, and a task restored after a `missing`
      // may have been left pointing at a path that no longer existed. The
      // restore's cwd rather than the checkout's root, so a project pointing
      // below the toplevel comes back where it was (TASK-65).
      cwd: restored.cwd,
      // Only `stale` keeps them, because only `stale` is a decision anybody
      // owes. `applied` consumed the snapshot; `none` means git had no such ref
      // to begin with — a row still naming one there is a leftover, and leaving
      // it is not harmless: `wip_ref` on a `present` checkout *is* how "owes a
      // decision" is spelled, so the task would show the refused-snapshot
      // notice for a snapshot that does not exist (Apply then failing on the
      // missing ref), and `snapshotTaskWip` refuses a row that already has one
      // — so it could never be evicted again either.
      ...(restored.wip === "stale" ? {} : { wip_ref: null, wip_at: null }),
    });
    this.host.broadcastTask(taskId);
    return restored;
  }
}
