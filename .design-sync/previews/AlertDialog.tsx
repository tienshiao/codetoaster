import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  Button,
} from "codetoaster";
import { Copy, TriangleAlert } from "lucide-react";

const noop = () => {};

/** The sidebar's "close a running session" confirm (App.tsx). */
export const CloseSession = () => (
  <AlertDialog open onOpenChange={noop}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Close session?</AlertDialogTitle>
        <AlertDialogDescription>
          "codetoaster · v2" is still running. Closing it ends the process; the
          session stays in the sidebar and reopens where it left off.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction variant="destructive">Close session</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

/** Irreversible removal — the destructive action carries the weight. */
export const DeleteProject = () => (
  <AlertDialog open onOpenChange={noop}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogMedia className="text-destructive">
          <TriangleAlert />
        </AlertDialogMedia>
        <AlertDialogTitle>Delete project "api-gateway"?</AlertDialogTitle>
        <AlertDialogDescription>
          Its 4 sessions move to General and their scrollback is kept. The
          project itself, its initial path and its ordering are removed for
          good.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction variant="destructive">Delete project</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

/** The review-submit confirm from DiffView: a media-free wide dialog that
 * previews exactly what will be written to the terminal, plus a third action. */
export const SubmitReview = () => (
  <AlertDialog open onOpenChange={noop}>
    <AlertDialogContent className="flex max-h-[80vh] flex-col">
      <AlertDialogHeader>
        <AlertDialogTitle>Send review to terminal?</AlertDialogTitle>
        <AlertDialogDescription>
          This will send the following prompt to the terminal's stdin as a
          single write:
        </AlertDialogDescription>
      </AlertDialogHeader>
      <pre className="bg-muted text-foreground border-border flex-1 overflow-auto rounded-md border p-3 text-xs whitespace-pre-wrap">
        {`Please address these review comments:

src/lib/xtmux/pty.ts:142
  resize() is called before the headless terminal exists on a
  cold attach — guard it or the first client wins a null deref.

src/lib/tasks/harvester.ts:88
  The idle window is measured from spawn, not from last output.`}
      </pre>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <Button variant="outline" className="gap-1.5">
          <Copy className="size-3.5" />
          Copy
        </Button>
        <AlertDialogAction>Send to Terminal</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

/** `size="sm"`: the compact, centred variant with a side-by-side footer. */
export const CompactConfirm = () => (
  <AlertDialog open onOpenChange={noop}>
    <AlertDialogContent size="sm">
      <AlertDialogHeader>
        <AlertDialogMedia>
          <TriangleAlert />
        </AlertDialogMedia>
        <AlertDialogTitle>Discard 3 comments?</AlertDialogTitle>
        <AlertDialogDescription>
          Leaving the diff view drops the review you have not sent yet.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Keep</AlertDialogCancel>
        <AlertDialogAction variant="destructive">Discard</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
