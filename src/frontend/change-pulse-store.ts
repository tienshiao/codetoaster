import { useCallback, useState, useSyncExternalStore } from "react";

/**
 * Which paths just changed, per root, so the lists showing them can flash the
 * row (TASK-136).
 *
 * The signal is the `changed` frame, not a comparison of list data. A file the
 * agent edits keeps its row in the Files tree exactly as it was — same name,
 * often the same size — so nothing in the listing would say it moved; the
 * watcher does. It is also what keeps a refetch that changed nothing from
 * flashing anything: no frame, no pulse.
 *
 * What this does *not* hold is whether a pulse should show. A list decides that
 * against the moment it mounted (`useChangePulses`), because the rule is "what
 * changed while you were looking": a tab switched back to, or a section the
 * rail just opened, starts quiet even if a pulse is still inside its window.
 * A row that *appears* after the change — the new file in Changes, the card
 * for a task file just written — belongs to a list that was already mounted,
 * so it flashes as it arrives.
 */

/** How long a pulse lasts: the CSS fade's length, and the window in which a
 * pulse still counts. `--duration-change-flash` in index.css says the same. */
export const PULSE_MS = 3000;

export interface Pulse {
  /** When the frame arrived, on the store's clock. */
  at: number;
  /** Counts this path's pulses: its parity picks which of the two identical
   * keyframes the row runs, which is what restarts the fade on a row that
   * changes again while still fading. Per path, never store-wide: a counter
   * shared with every other path flips parity once per path recorded in
   * between, so an odd number of other changes left a row on the class it
   * already had, and the second write to it did not flash at all. */
  seq: number;
  /** A path the repository ignores. Shown on its own row, but not rolled up
   * into a collapsed directory: a build writing `dist/` every second would
   * otherwise keep every ancestor lit for as long as it runs. */
  ignored: boolean;
}

type Pulses = ReadonlyMap<string, Pulse>;
const EMPTY: Pulses = new Map();

/** Prefix of a directory's own pulse in the map. A NUL cannot start a path, so
 * it never collides with a file's. */
const DIR = "\u0000dir:";

export class ChangePulseStore {
  private roots = new Map<string, Pulses>();
  private listeners = new Map<string, Set<() => void>>();
  /** Each path's last `seq`, kept past its pulse's expiry. A row whose fade has
   * run out still carries the class until something re-renders it, so the
   * next pulse has to take the other one even then. One small number per path
   * ever changed in the session. */
  private seqs = new Map<string, Map<string, number>>();

  constructor(readonly now: () => number = () => Date.now()) {}

  /** Paths changed under `rootId`. Expired pulses for the root are dropped on
   * the way, so a long session does not accumulate every path ever written. */
  record(rootId: string, paths: readonly string[], ignored: readonly string[] = []): void {
    if (paths.length === 0 && ignored.length === 0) return;
    const at = this.now();
    const next = new Map<string, Pulse>();
    for (const [path, pulse] of this.roots.get(rootId) ?? EMPTY) {
      if (at - pulse.at < PULSE_MS) next.set(path, pulse);
    }
    let seqs = this.seqs.get(rootId);
    if (!seqs) this.seqs.set(rootId, (seqs = new Map()));
    const bump = (path: string) => {
      const seq = (seqs.get(path) ?? -1) + 1;
      seqs.set(path, seq);
      return seq;
    };
    for (const path of paths) next.set(path, { at, seq: bump(path), ignored: false });
    for (const path of ignored) next.set(path, { at, seq: bump(path), ignored: true });
    // Every directory holding a changed path gets a pulse of its own, once per
    // frame however many of its files moved, so a collapsed one alternates its
    // class on each frame that reaches it — which a class borrowed from one of
    // its children cannot do, since two children each start their own count.
    // Ignored paths lend their directories nothing (see `Pulse.ignored`).
    const dirs = new Set<string>();
    for (const path of paths) {
      for (let cut = path.indexOf("/"); cut !== -1; cut = path.indexOf("/", cut + 1)) {
        dirs.add(path.slice(0, cut));
      }
    }
    for (const dir of dirs) {
      const key = DIR + dir;
      next.set(key, { at, seq: bump(key), ignored: false });
    }
    this.roots.set(rootId, next);
    for (const listener of this.listeners.get(rootId) ?? []) listener();
  }

  /** The root's pulses. A new map per `record`, so it is a valid
   * `useSyncExternalStore` snapshot. */
  pulses(rootId: string): Pulses {
    return this.roots.get(rootId) ?? EMPTY;
  }

  /** Forget every root not in `rootIds`: a task that is gone keeps no pulses
   * and no per-path counts (the same sweep `retainTaskViewStates` runs). */
  retain(rootIds: ReadonlySet<string>): void {
    for (const id of this.roots.keys()) if (!rootIds.has(id)) this.roots.delete(id);
    for (const id of this.seqs.keys()) if (!rootIds.has(id)) this.seqs.delete(id);
  }

  subscribe(rootId: string, listener: () => void): () => void {
    let set = this.listeners.get(rootId);
    if (!set) this.listeners.set(rootId, (set = new Set()));
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(rootId);
    };
  }
}

export const changePulses = new ChangePulseStore();

/** The pulse on `path` itself, if it is one to show: after `since` and still
 * inside its window at `now`. */
export function pulseAt(pulses: Pulses, path: string, since: number, now: number): Pulse | undefined {
  const pulse = pulses.get(path);
  return pulse && live(pulse, since, now) ? pulse : undefined;
}

/** The showable pulse for something changing strictly under directory `dir`,
 * for a collapsed directory standing in for the rows it hides. Ignored paths
 * do not count. */
export function pulseUnder(pulses: Pulses, dir: string, since: number, now: number): Pulse | undefined {
  const pulse = pulses.get(DIR + dir);
  return pulse && live(pulse, since, now) ? pulse : undefined;
}

function live(pulse: Pulse, since: number, now: number): boolean {
  return pulse.at >= since && now - pulse.at < PULSE_MS;
}

/** The class that runs the fade. Two identical animations under two names,
 * alternated by sequence: changing `animation-name` is what makes a browser
 * restart an animation on an element that is already running one. */
export function flashClass(seq: number): string {
  return seq % 2 === 0 ? "change-flash-a" : "change-flash-b";
}

/** What a list asks of the pulses: the class for a row, or undefined. */
export interface ChangeFlash {
  /** A row for the path itself. */
  row(path: string): string | undefined;
  /** A collapsed directory: the newest change anywhere under it. */
  under(dir: string): string | undefined;
}

/**
 * The moment a view of `rootId` started looking: its mount, and again whenever
 * it is pointed at another root. The Explorer is not keyed by root, so a
 * section that stays mounted across a task switch must not show the new
 * task's pulses from before the switch.
 */
export function useChangeBaseline(
  rootId: string | null | undefined,
  store: ChangePulseStore = changePulses,
): number {
  const [base, setBase] = useState(() => ({ rootId, since: store.now() }));
  if (base.rootId !== rootId) {
    const next = { rootId, since: store.now() };
    setBase(next);
    return next.since;
  }
  return base.since;
}

/**
 * The pulses for `rootId` as a list mounted now should show them, or
 * undefined when `rootId` is — a view of something that cannot change (a
 * commit) passes none, and gets nothing.
 *
 * The baseline is this hook's mount, so the component calling it should be the
 * *list*, not a row: a row mounted by the refetch the change caused would
 * otherwise date its baseline after the change and never flash.
 */
export function useChangePulses(
  rootId: string | null | undefined,
  store: ChangePulseStore = changePulses,
  /** A baseline the caller holds instead (`useChangeBaseline`), for a list
   * that is unmounted and remounted under a component that stays: the
   * working-tree diff drops its layout for "No changes" and back. */
  sinceOverride?: number,
): ChangeFlash | undefined {
  const own = useChangeBaseline(rootId, store);
  const since = sinceOverride ?? own;
  const subscribe = useCallback(
    (listener: () => void) => (rootId ? store.subscribe(rootId, listener) : () => {}),
    [rootId, store],
  );
  const pulses = useSyncExternalStore(subscribe, () => (rootId ? store.pulses(rootId) : EMPTY));

  if (!rootId) return undefined;
  // The clock is read per render, not per snapshot. A list re-rendering later
  // for its own reasons — a directory opened, a filter typed — must not hand
  // a pulse that has run out to a row it mounts just now, which would start a
  // fade for a change long past.
  const now = store.now();
  return {
    row: (path) => {
      const pulse = pulseAt(pulses, path, since, now);
      return pulse ? flashClass(pulse.seq) : undefined;
    },
    under: (dir) => {
      const pulse = pulseUnder(pulses, dir, since, now);
      return pulse ? flashClass(pulse.seq) : undefined;
    },
  };
}
