import { unarchiveSummary } from "@/frontend/unarchive-summary";
import type { TaskResult } from "@/frontend/TaskContext";
import type { UnarchivePreview } from "@/lib/xtmux/types";
import { Dialog } from "@/frontend/components/v2/Dialog";
import { usePreviewOnOpen } from "@/frontend/hooks/use-preview-on-open";

/**
 * The unarchive confirmation, with what comes back fetched on open (TASK-139).
 *
 * Its own module, and its own component, for the reason `ArchiveTaskDialog` is
 * one: two surfaces ask the same question — the archived row's button and the
 * command palette's Unarchive — and the preview fetch, its cancellation and the
 * checking / failed / answered states must not be written twice.
 *
 * Confirming does not wait on the preview having *succeeded*, only on it
 * having answered: a preview git could not produce is said out loud, and the
 * unarchive itself still restores what it can and reports a failure as a toast.
 */
export interface UnarchiveTaskDialogProps {
  open: boolean;
  taskId: string;
  label: string;
  /** What unarchiving would restore. A string is the server's reason it
   * refused to plan one — a state of the task (409), which the dialog quotes;
   * null is a failure it can only say happened. See `unarchivePreviewAnswer`. */
  onUnarchivePreview: (id: string) => Promise<UnarchivePreview | string | null>;
  onUnarchive: (id: string) => void;
  onClose: () => void;
}

/** The preview request's result as the dialog takes it. A 409 carries the
 * reason the server will refuse the unarchive too — a repository nobody can
 * name, a branch with nothing left to recreate it from, a task some other
 * browser already unarchived — and saying "unarchiving still brings back what
 * it can" over it would promise the one thing that cannot happen. Anything
 * else is a preview that merely failed. */
export function unarchivePreviewAnswer(
  result: TaskResult<UnarchivePreview>,
): UnarchivePreview | string | null {
  if (result.ok) return result.value;
  return result.error.status === 409 ? result.error.message : null;
}

function UnarchiveBody({
  preview,
  failed,
}: {
  preview: UnarchivePreview | string | null;
  failed: boolean;
}) {
  if (typeof preview === "string") {
    return (
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <p>{preview}</p>
        <p>Unarchiving will be refused until that changes.</p>
      </div>
    );
  }
  if (failed) {
    return (
      <p className="text-xs text-muted-foreground">
        What can be restored could not be established. Unarchiving still brings
        back what it can, and says so if it cannot.
      </p>
    );
  }
  if (!preview) {
    return <p className="text-xs text-muted-foreground">Checking what can be restored…</p>;
  }
  return (
    <ul className="flex list-none flex-col gap-1 text-xs text-muted-foreground">
      {unarchiveSummary(preview).map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

export function UnarchiveTaskDialog({
  open,
  taskId,
  label,
  onUnarchivePreview,
  onUnarchive,
  onClose,
}: UnarchiveTaskDialogProps) {
  const { preview, failed } = usePreviewOnOpen(open, taskId, onUnarchivePreview);

  return (
    <Dialog
      open={open}
      title="Unarchive this task?"
      description={`${label} returns to the list. What comes back:`}
      confirmLabel="Unarchive"
      confirmDisabled={!preview && !failed}
      onConfirm={() => onUnarchive(taskId)}
      onClose={onClose}
    >
      <UnarchiveBody preview={preview} failed={failed} />
    </Dialog>
  );
}
