import { useEffect, useState } from "react";

/**
 * A confirmation's preview, fetched each time the dialog opens: what archiving
 * would remove, what unarchiving would restore.
 *
 * Asked on every open, not once: the answer is read from git, and a dialog
 * reopened an hour later must not quote what git said the first time. The
 * answer of a superseded open is discarded rather than cancelled — there is
 * nothing to cancel — because a dialog closed and reopened has two in flight,
 * and the slower one would otherwise land on top of the newer answer.
 *
 * `failed` is the fetch resolving to null *or rejecting*. The rejection has to
 * be handled or the failed state is unreachable by the one route that reaches
 * it without a resolved value: `request` swallows fetch and HTTP failures, so
 * what is left to throw is a 200 whose body would not parse. Unhandled, that
 * leaves the dialog on its "checking" line for good, with the confirm disabled
 * and nothing saying why.
 */
export function usePreviewOnOpen<T>(
  open: boolean,
  taskId: string,
  fetchPreview: (id: string) => Promise<T | null>,
): { preview: T | null; failed: boolean } {
  const [preview, setPreview] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setPreview(null);
    setFailed(false);
    void fetchPreview(taskId)
      .catch(() => null)
      .then((answer) => {
        if (!live) return;
        setPreview(answer);
        setFailed(answer === null);
      });
    return () => {
      live = false;
    };
  }, [open, taskId, fetchPreview]);

  return { preview, failed };
}
