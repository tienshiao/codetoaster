import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { PULSE_MS } from "./change-pulse-store";

/**
 * The task list's reorder cue and click lockout (TASK-146).
 *
 * The list re-sorts in place: a task reranks (TASK-116), one is created, one
 * is archived or suspended out of it. Any of those can slide a different row
 * under a pointer that is already on its way down, and the click — open,
 * archive — lands on a task the user never aimed at. So a reorder does two
 * things: the rows that moved flash (the `--changed` fade from TASK-136), and
 * for `REORDER_LOCK_MS` afterwards the list ignores clicks.
 *
 * **What counts as a reorder** is a change in the sequence of rows the list
 * draws, compared with the one it drew last. That takes in the three ways a
 * row ends up under the pointer it was not under before:
 *
 * - a row moving (a rank change, or a project group overtaking another);
 * - a row inserted above it (a new task), which pushes it down;
 * - a row removed above it (archived, or gone from the live list), which pulls
 *   it up. Its relative order is unchanged, which is exactly why a detector
 *   looking for "moves" would miss the case the user reported.
 *
 * Precisely: some row drawn before is drawn in a different slot now. A row
 * added or removed at the very end moves nothing and does not count.
 *
 * What does not: anything that redraws a row in place — its age, its state
 * dot, its preview line, its selection — since none of those are in the
 * sequence. Nor does the first non-empty sequence (the snapshot arriving on
 * load: nothing was under the pointer), a remount (a fresh baseline), or a
 * change the user made to the view itself — the filter, the grouping, a
 * group's chevron, the archived toggle and the first archived rows it fetches.
 * Those are the user's own doing, or the direct answer to it, and locking the
 * list after typing a filter would block the click on the row it found. A view
 * change is only taken as the cause when the data did not move in the same
 * render: if both did, it counts, because a spurious half-second lock is far
 * cheaper than a missed one. The archived list, once it is showing, is data:
 * a delete for good resolving pulls the rows below it up like any removal.
 *
 * The cue goes on rows that were inserted and on rows that left the longest
 * run that kept its relative order — so one task jumping to the top lights
 * that task and not the rows it stepped over. A removal locks and lights
 * nothing: there is no row left to light, and the rows below kept their order.
 * The keys are whatever the caller draws; the sidebar's include project
 * headers, and a cued header lights its whole group.
 */

/** How long the list ignores clicks after a reorder, extended by each later
 * one. Long enough to cover a click whose motion had already started when the
 * row moved, short enough that a deliberate second click is not refused. */
export const REORDER_LOCK_MS = 500;

/** How long a cue is held on a row: the length of the change flash it runs. */
export const REORDER_CUE_MS = PULSE_MS;

export interface OrderChange {
  /** Some row that was drawn before is drawn in a different slot now — so
   * something different sits under wherever the pointer is. A row added or
   * removed at the very end moves nothing, and is not a change: the user's own
   * New project appends an empty header there, and locking would refuse the
   * click on it that comes next. */
  changed: boolean;
  /** Keys to cue: inserted, or moved out of the order the rest kept. Empty
   * when nothing changed. */
  cued: string[];
}

const NO_CHANGE: OrderChange = { changed: false, cued: [] };

/**
 * How `next` differs from `prev`, as sequences of row keys.
 *
 * The moved rows are found as the complement of a longest increasing
 * subsequence of the surviving rows' old positions, read in their new order:
 * that subsequence is the largest set of rows that can be said to have stayed
 * put, and everything else had to move to get where it is.
 */
export function orderChange(prev: readonly string[], next: readonly string[]): OrderChange {
  const before = new Map(prev.map((key, i) => [key, i]));
  const surviving: { key: string; was: number }[] = [];
  const cued: string[] = [];
  let shifted = false;
  next.forEach((key, i) => {
    const was = before.get(key);
    if (was === undefined) {
      cued.push(key);
    } else {
      surviving.push({ key, was });
      if (was !== i) shifted = true;
    }
  });
  if (!shifted) return NO_CHANGE;
  const kept = longestIncreasing(surviving.map((s) => s.was));
  surviving.forEach((s, i) => {
    if (!kept.has(i)) cued.push(s.key);
  });
  return { changed: true, cued };
}

/** Indices into `values` of one longest strictly increasing subsequence
 * (patience sorting, O(n log n)). */
function longestIncreasing(values: readonly number[]): Set<number> {
  /** `tails[k]`: index of the smallest last value of any run of length k+1. */
  const tails: number[] = [];
  const parent = new Array<number>(values.length).fill(-1);
  values.forEach((value, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (values[tails[mid]!]! < value) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) parent[i] = tails[lo - 1]!;
    tails[lo] = i;
  });
  const kept = new Set<number>();
  for (let i = tails.length ? tails[tails.length - 1]! : -1; i !== -1; i = parent[i]!) kept.add(i);
  return kept;
}

/** A row's cue: when it was set, and how many times in a row it has been set
 * while still showing — whose parity picks the flash class, so a row that
 * moves again mid-fade restarts it instead of stacking a second one. */
export interface ReorderCue {
  at: number;
  seq: number;
}

interface GuardState {
  /** The sequence last accepted: the baseline the next one is compared to. */
  sequence: readonly string[];
  lockedUntil: number;
  cues: ReadonlyMap<string, ReorderCue>;
  /** Bumped by each timer firing, so the timer effect runs again even when
   * nothing else in the state moved — which is how an unlock that fires early
   * reschedules itself instead of leaving the list locked. */
  tick: number;
}

export interface ReorderGuard {
  /** Clicks in the list are to be ignored. */
  locked: boolean;
  /** The rows currently cued. Removed by a timer when their flash has run, so
   * a row mounted afresh later — a group reopened, the sidebar shown again —
   * does not replay a fade for a reorder long past. A new map whenever it
   * changes, so it can be a memo dependency. */
  cues: ReadonlyMap<string, ReorderCue>;
}

export interface ReorderGuardOptions {
  now?: () => number;
  lockMs?: number;
  cueMs?: number;
}

const NO_CUES: ReadonlyMap<string, ReorderCue> = new Map();

function sameItems(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
}

function sameSequence(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** The cues still inside their window at `t`, or the same map when none ran
 * out. */
function liveCues(
  cues: ReadonlyMap<string, ReorderCue>,
  t: number,
  cueMs: number,
): ReadonlyMap<string, ReorderCue> {
  let out: Map<string, ReorderCue> | null = null;
  for (const [key, cue] of cues) {
    if (t - cue.at < cueMs) continue;
    out ??= new Map(cues);
    out.delete(key);
  }
  return out ?? cues;
}

/**
 * Watch the drawn `sequence` for reorders.
 *
 * `view` lists what the user controls about the list (see the module comment):
 * a sequence change in a render where one of those changed and `data` did not
 * is taken as the user's own and only moves the baseline. `data` is what moves
 * without being asked — the live task list, the archived one — compared item
 * by item.
 *
 * The comparison runs during render, not in an effect, so the frame in which
 * the rows have moved is already the locked one: an effect would commit the
 * moved rows first and lock a paint later, which is the window this exists to
 * close.
 */
export function useReorderGuard(
  sequence: readonly string[],
  view: readonly unknown[],
  data: readonly unknown[],
  { now = Date.now, lockMs = REORDER_LOCK_MS, cueMs = REORDER_CUE_MS }: ReorderGuardOptions = {},
): ReorderGuard {
  const [state, setState] = useState<GuardState>(() => ({
    sequence,
    lockedUntil: 0,
    cues: NO_CUES,
    tick: 0,
  }));
  // The view and data the last *committed* render saw. Not state: they change
  // on every activity frame and every keystroke in the filter, and holding them
  // in state would cost a second render for each of those to record a value
  // that changes nothing on screen.
  const committed = useRef({ view, data });
  useLayoutEffect(() => {
    committed.current = { view, data };
  });

  let current = state;
  if (!sameSequence(state.sequence, sequence)) {
    const userMoved =
      !sameItems(committed.current.view, view) && sameItems(committed.current.data, data);
    const change = orderChange(state.sequence, sequence);
    if (userMoved || state.sequence.length === 0 || !change.changed) {
      current = { ...state, sequence };
    } else {
      const t = now();
      const cues = new Map(liveCues(state.cues, t, cueMs));
      for (const key of change.cued) {
        // From the map as drawn, not the pruned one: a cue past its window
        // whose timer has not fired yet (a throttled background tab) still has
        // its class on the row, so the new cue must take the other one or the
        // fade does not restart.
        const prev = state.cues.get(key);
        cues.set(key, { at: t, seq: prev ? prev.seq + 1 : 0 });
      }
      current = { ...state, sequence, lockedUntil: t + lockMs, cues };
    }
    setState(current);
  }

  // One timer for both the unlock and the cues running out: whichever is due
  // first. Re-run on every state change, so an extension pushes it back.
  useEffect(() => {
    const t = now();
    let due = state.lockedUntil > t ? state.lockedUntil : Infinity;
    for (const cue of state.cues.values()) due = Math.min(due, cue.at + cueMs);
    if (due === Infinity) return;
    const id = setTimeout(
      () =>
        setState((s) => ({ ...s, cues: liveCues(s.cues, now(), cueMs), tick: s.tick + 1 })),
      Math.max(0, due - t),
    );
    return () => clearTimeout(id);
  }, [state, now, cueMs]);

  // Pruned by the clock here as well as by the timer: a background tab holds
  // timers back, and a row mounted before that one fires (a group reopened, a
  // filter cleared) must not start a fade for a reorder from minutes ago.
  const t = now();
  return { locked: current.lockedUntil > t, cues: liveCues(current.cues, t, cueMs) };
}
