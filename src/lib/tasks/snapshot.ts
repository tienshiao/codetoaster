import { rename } from "node:fs/promises";
import { taskScrollbackPath } from "../agent/spawn";

// The scrollback snapshot on disk (docs/v2-architecture.md §5.1), and nothing
// else. It knows about a task id and a path, not about PtyManager or
// TaskManager — which is what lets the restore path (TASK-17) read a snapshot
// for a task that has no live terminal and no manager in play, and what keeps
// the harvester (TASK-15) from having to reach through the policy layer to
// write one.

/** Replace the task's snapshot with `data`. Bun.write creates the task's
 * directory on the way, so this works for a task whose only other file — the
 * settings.json — was never written.
 *
 * Written beside the real path and renamed over it, because the file is read
 * by someone else while it is being written: reopening a task fetches its
 * scrollback the moment the click lands, and that can be the same moment the
 * harvester's tick — or another client's close — is writing one. A partial
 * ANSI stream repaints as garbage, and a daemon killed mid-write would leave
 * that garbage as the task's screen for good. `rename` within one directory is
 * atomic, so a reader sees either the old snapshot or the new one. */
export async function writeSnapshot(taskId: string, data: string): Promise<void> {
  const target = taskScrollbackPath(taskId);
  const staging = `${target}.tmp`;
  await Bun.write(staging, data);
  try {
    await rename(staging, target);
  } catch (e) {
    // Nothing readable was published, so the old snapshot still stands — but
    // the staging file would linger, so take it with us on the way out.
    await Bun.file(staging).delete().catch(() => {});
    throw e;
  }
}

/** The task's last screen, or undefined when it has none. Absent is one
 * answer, not several: a task that was never harvested, one whose directory a
 * user deleted, and one closed before a tick ever ran are indistinguishable to
 * a caller, and all three mean "there is nothing to repaint". */
export async function readSnapshot(taskId: string): Promise<string | undefined> {
  const file = Bun.file(taskScrollbackPath(taskId));
  if (!(await file.exists())) return undefined;
  try {
    return await file.text();
  } catch {
    // The check above and the read are two separate awaits, and `closeTask`
    // fires its removal without awaiting it — so a restore running alongside a
    // close can watch the file disappear between them. That is still "there is
    // nothing to repaint", and rejecting instead would make a liar of the
    // contract above.
    return undefined;
  }
}

/** Best-effort removal. A missing file is the state this is trying to reach,
 * so it is a success rather than something for the caller to handle. The
 * staging file goes too: a write interrupted before its rename leaves one
 * behind, and the task it belonged to is the one being deleted. */
export async function removeSnapshot(taskId: string): Promise<void> {
  const target = taskScrollbackPath(taskId);
  await Bun.file(target).delete().catch(() => {});
  await Bun.file(`${target}.tmp`).delete().catch(() => {});
}
