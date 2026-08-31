import { useCallback, useState } from "react";
import { useTasks } from "@/frontend/TaskContext";
import { Button } from "@/frontend/components/v2/Button";
import { Notice } from "@/frontend/components/v2/Notice";
import { Dialog } from "@/frontend/components/v2/Dialog";

/**
 * The decision a refused snapshot leaves behind (§5.6).
 *
 * When a task's checkout is rebuilt and the branch has moved since the snapshot
 * was taken, the restore does not apply it: the old version of every tracked
 * file would go over the newer commit, and the loss would be silent. So the
 * checkout comes back clean, the agent resumes normally, and the work waits in
 * `refs/codetoaster/wip/<id>` for the user to say what should happen to it.
 *
 * Above the tab area rather than inside the agent pane, because the checkout is
 * what every tab is looking at — the diff, the file tree and the history all
 * read the same tree, and a decision about that tree shown only on the terminal
 * tab would be invisible to a user working in any of them. Once, too: a split
 * renders two agent panes and this is one question.
 */
export function WipNotice({ taskId }: { taskId: string }) {
  const { resolveWip } = useTasks();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Dismissed for this visit. Deliberately not sent anywhere: "decide later"
   * is the absence of a request, so the row goes on saying the decision is
   * outstanding and the next load asks again. That is the honest behaviour —
   * the work is still sitting in a ref, and a dismissal that persisted would be
   * a promise to forget about it that nothing on the server has made. */
  const [kept, setKept] = useState(false);

  const act = useCallback(
    async (action: "apply" | "discard") => {
      setBusy(true);
      // Not cleared when the server actually did something: the task delta
      // that follows drops `wipPending` and unmounts this outright. It is
      // cleared for the other two answers — a failure, where the error has
      // already been reported and the buttons have to come back, and a
      // `done: false`, which is another client having answered first. That one
      // sends no delta, so leaving `busy` set would strand a notice with three
      // disabled buttons and no way out.
      const result = await resolveWip(taskId, action);
      if (!result.ok || !result.value.done) setBusy(false);
      setConfirming(false);
    },
    [resolveWip, taskId],
  );

  if (kept) return null;

  return (
    <>
      <Notice
        tone="warning"
        actions={
          <>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirming(true)}>
              Apply
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setKept(true)}>
              Later
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act("discard")}>
              Discard
            </Button>
          </>
        }
      >
        Saved changes could not be restored — this branch moved while the task was away.
      </Notice>

      {/* Only `Apply` asks. It is the one that writes over a checkout the user
          may have been working in since, and the sentence has to name what it
          overwrites rather than ask "are you sure?" — which tells them nothing
          they did not already know from having clicked. Discard destroys a
          snapshot the user has just been told is unusable here, and the branch
          still has every commit; making both confirm would train the reflex
          that gets a real confirmation clicked through. */}
      <Dialog
        open={confirming}
        title="Apply the saved changes?"
        description="The files this task was working on will be written over whatever is in the checkout now, including anything committed to the branch since. The branch history itself is not touched."
        confirmLabel="Apply"
        confirmDisabled={busy}
        onConfirm={() => void act("apply")}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}
