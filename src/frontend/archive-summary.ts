import type { ArchivePreview } from "@/lib/xtmux/types";
import { calendarDate } from "@/frontend/utils/taskTimes";

/** The clock and the calendar the sentences are written against. Injected so a
 * test can state the date it expects; the dialog takes the defaults. */
export interface SummaryClock {
  now?: number;
  formatDate?: (timestamp: number) => string;
}

const DAY_MS = 86_400_000;

/**
 * What archiving a task would cost, in sentences (§5.6).
 *
 * A pure function over the preview, and its own module for the reason
 * `task-list.ts` is: this is the text of the one dialog in the app that stands
 * between a user and their uncommitted work, and it should be checkable
 * against inputs rather than only through a rendered dialog.
 *
 * Two rules run through all of it.
 *
 * **Nothing is stated that git did not establish.** `BranchStatus` fails
 * closed — a git that did not exit 0 answers "we could not establish this",
 * never "it is safe" — so a `0` here can mean either "nothing to report" or
 * "we could not tell", and the row's rule applies: a count is drawn only when
 * it is known and non-zero. `dirty: null` is the third answer again, and it
 * gets its own sentence rather than being folded into silence — but the
 * sentence names both of the things it can mean, because `dirtyCount` answers
 * null for an evicted checkout and for one git could not read, and the dialog
 * has nothing to tell them apart with.
 *
 * **The branch is always spoken to when there is one.** It is the part of the
 * archive a user does not expect to have an opinion about, and the part they
 * will find later on their disk if it is kept.
 *
 * **The last line is the way back** (TASK-139): archiving is undoable, and a
 * user who is told so — and until when — is a user who can archive the moment
 * they think they are done, rather than leaving the task in the list in case.
 * The date is today plus the retention the server sent, since retention is
 * measured from the archive.
 */
export function archiveSummary(
  preview: ArchivePreview,
  { now = Date.now(), formatDate = calendarDate }: SummaryClock = {},
): string[] {
  const lines: string[] = [];
  const { status, branch, branchWouldBeDeleted, wipRetentionDays } = preview;

  if (!status) {
    // `archivePreview` answers null here for two different reasons, and the
    // branch is what tells them apart: `branchStatusOf` returns null when the
    // row has no branch *or* when its repository could not be resolved. Saying
    // "no checkout of its own" of the second is the fail-closed rule run
    // backwards — a positive claim about the disk on evidence nobody gathered,
    // in the one dialog whose whole job is to be true about uncommitted work —
    // and it also drops the branch, which this file promises always to speak
    // to when there is one.
    //
    // The archive itself agrees: with no repository root, `doArchive` skips
    // both `evictWorktree` and the branch deletion, so a branch named here
    // really is left standing.
    if (branch) {
      // No date: whether there will be a snapshot to bring back depends on the
      // repository this could not read.
      return [
        `Its repository could not be read, so what archiving removes could not be established.`,
        `The branch ${branch} is not deleted.`,
        "It can be unarchived from the archived list.",
      ];
    }
    // No branch at all: the task ran in the project's own directory. There is
    // no checkout of ours to remove and no branch of ours to weigh, so the
    // archive is only the row and the files — and nothing of it expires, so
    // the way back has no date on it either.
    return [
      "This task has no checkout of its own, so nothing on disk is removed.",
      "It can be unarchived from the archived list at any time.",
    ];
  }

  if (status.dirty === null) {
    // Two ways to reach null and no way to tell them apart from here: the
    // checkout is not on disk (an evicted task, the ordinary case), or git
    // could not read one that is. `dirtyCount` folds both into the same answer
    // deliberately, so this sentence must not pick one — "already gone" said of
    // a checkout git merely failed on is the fail-closed rule run backwards, in
    // the one dialog whose whole job is to be true about uncommitted work.
    lines.push(
      "Its uncommitted files could not be counted — the checkout is gone from disk, or git could not read it. Anything still there is snapshotted first.",
    );
  } else if (status.dirty > 0) {
    lines.push(
      `${count(status.dirty, "uncommitted file")} will be saved to a snapshot, kept for ${count(wipRetentionDays, "day")}.`,
    );
  }

  if (status.unpushed > 0) {
    lines.push(`The branch has ${count(status.unpushed, "unpushed commit")}.`);
  }

  if (branch && !status.exists) {
    // `exists` is fail-closed too — false is "not found", which covers a branch
    // somebody deleted and a repository git could not read — so this says what
    // was looked for and what happens, and claims nothing about why. What it
    // must not do is fall through to the sentence below: `branchWouldBeDeleted`
    // is false here *because there is no branch to delete*, and reporting that
    // as "kept, since deleting it would take that work with it" invents unpushed
    // work on a ref that is not there.
    lines.push(`The branch ${branch} was not found, so nothing here deletes it.`);
  } else if (branch) {
    lines.push(
      branchWouldBeDeleted
        ? `The branch ${branch} will be deleted — its work is already ${status.merged ? "merged into its base" : "on a remote"}.`
        : `The branch ${branch} will be kept, since deleting it would take that work with it.`,
    );
  }

  // Always written, clean tree or not, because archive snapshots
  // unconditionally — so "with its uncommitted work" is true whether or not
  // there is any.
  //
  // The date belongs to the snapshot, not to unarchiving: after it the task
  // still unarchives, onto its branch without the uncommitted work. A sentence
  // putting the date on "unarchived" read as a deadline for coming back at all.
  lines.push(
    `It can be unarchived at any time, and its uncommitted work comes back with it until ${formatDate(now + wipRetentionDays * DAY_MS)}.`,
  );

  return lines;
}

/** "1 file", "2 files" — the plural rule the rest of the sidebar uses. */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
