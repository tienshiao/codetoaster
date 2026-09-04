// Which project the composer has just been asked to open on (§7.5).
//
// The ask travels out of band rather than in the URL, because the URL cannot
// carry it. `?project=` is a preference and not an address: it seeds the
// selection on arrival so a copied `/?project=web` still opens on web, and the
// chip is never written back to it. That makes a second press of the same
// project group's `+` a navigation to the address already showing — a no-op —
// so a composer whose chip had since been changed by hand stayed where it was
// and the button read as inert (TASK-82).
//
// The two ways to fix that inside the URL both cost more than they are worth: a
// nonce (`?project=web&n=2`) makes every press a distinct navigation but puts a
// meaningless token in an address a user might copy, and writing the chip back
// turns the param into the address §7.5 deliberately kept it from being — and
// pushes a history entry every time the selection moves.
//
// So a press is a *request*, counted here. `seq` is what makes two presses of
// the same project two events; the composer moves its selection whenever the
// count it last saw changes, and nothing about the address moves at all.

export interface ComposerRequest {
  /** The project asked for, or null when nothing has been asked for yet. */
  projectId: string | null;
  /** Incremented per request, so asking twice for the same project reads as
   * two asks rather than as no change. */
  seq: number;
}

const NONE: ComposerRequest = { projectId: null, seq: 0 };

let current: ComposerRequest = NONE;

type Listener = () => void;

const listeners = new Set<Listener>();

function notify(): void {
  // Copied: a listener may unsubscribe (the composer unmounting) mid-walk.
  for (const listener of [...listeners]) listener();
}

/** Ask the composer to open on `projectId`, whether or not it is already
 * showing and whatever its chip currently says. */
export function requestComposerProject(projectId: string): void {
  current = { projectId, seq: current.seq + 1 };
  notify();
}

/** The snapshot `useSyncExternalStore` compares by identity: replaced only when
 * a request is actually made, so a re-render on its own is not one. */
export function getComposerRequest(): ComposerRequest {
  return current;
}

export function subscribeComposerRequest(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Module state outlives a test, and a count carried into the next one is a
 * request nobody made. */
export function resetComposerRequest(): void {
  current = NONE;
  notify();
}
