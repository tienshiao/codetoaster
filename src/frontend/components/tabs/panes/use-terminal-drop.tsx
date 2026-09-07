import { X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { IconButton } from "@/frontend/components/v2/IconButton";
import { uploadToTerminal } from "@/frontend/lib/upload-api";
import { OverlayCard, OverlayCause } from "./OverlayCard";

/** How long a failure stays on screen if nobody dismisses it. Long enough to
 * be read after looking up from the drop; short enough that a pane the user
 * has moved on from is not still wearing it. */
const FAILURE_MS = 8000;

/**
 * Files dropped on a terminal pane (TASK-96).
 *
 * The grid draws the drop target and hands the files here; the server stages
 * them beside the composer's attachments and types their quoted paths into
 * the PTY this pane is showing — *this* PTY, not the task's agent: a path
 * typed into the wrong terminal is a path the user has to carry over by hand.
 *
 * Nothing is typed by the client. The server writes the paths, so a drop is
 * one round trip and the path arrives in the PTY exactly once, whatever
 * clients are attached. What the client does own is the failure: the route is
 * the only place a drop can go wrong, and without this a drop that failed
 * would look exactly like a drop that was never noticed.
 */
export function useTerminalDrop(taskId: string, ptyId: string | null) {
  // An object rather than the bare string, so two identical messages in a row
  // are two distinct states and the second one restarts the timer below.
  const [failure, setFailure] = useState<{ message: string } | null>(null);

  // The state owns its own expiry: the effect re-runs for each new failure, so
  // its cleanup cancels the previous timer, and unmounting cancels the last.
  useEffect(() => {
    if (!failure) return;
    const t = setTimeout(() => setFailure(null), FAILURE_MS);
    return () => clearTimeout(t);
  }, [failure]);

  const dismiss = useCallback(() => setFailure(null), []);

  const onFileDrop = useCallback(
    (files: File[]) => {
      // A suspended task's grid still shows the drop target, over a snapshot of
      // a terminal that is not there. Said here rather than left to the route's
      // 404, because the route would also be asked to receive the files first.
      if (ptyId === null) {
        setFailure({ message: "This terminal is not running." });
        return;
      }
      // A success clears nothing. Two drops can be in flight over one pane, and
      // the slow one's success would otherwise erase the fast one's error — a
      // failure leaves on its own timer, or when the user dismisses it.
      uploadToTerminal(taskId, ptyId, files).then(undefined, (error: unknown) =>
        setFailure({ message: error instanceof Error ? error.message : String(error) }),
      );
    },
    [taskId, ptyId],
  );

  return { onFileDrop, failure: failure?.message ?? null, dismiss };
}

/**
 * The failure, floated over the bottom of the grid.
 *
 * An `OverlayCard` and, like `AgentPane`'s reopen pill, not a `Notice`: it
 * appears over a live terminal the user is working in, and taking a row of
 * height would renegotiate the grid for a sentence that leaves on its own.
 */
export function TerminalDropFailure({
  failure,
  onDismiss,
}: {
  failure: string;
  onDismiss: () => void;
}) {
  return (
    <OverlayCard side="bottom" role="alert">
      <span>
        Upload failed
        <OverlayCause>{failure}</OverlayCause>
      </span>
      <IconButton icon={X} size="sm" label="Dismiss" onClick={onDismiss} />
    </OverlayCard>
  );
}
