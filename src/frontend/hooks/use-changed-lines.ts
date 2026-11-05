import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { PULSE_MS, flashClass } from "@/frontend/change-pulse-store";
import { changedLines } from "@/frontend/utils/changedLines";

export interface LineFlash {
  /** Indices into the `lines` the hook was given. */
  lines: ReadonlySet<number>;
  /** The class those lines carry; see `flashClass`. */
  className: string;
}

/**
 * The lines to flash in a view whose content just changed under it (TASK-136):
 * an open file the agent wrote, or a diff whose hunks moved.
 *
 * Unlike the list rows, this compares content, because content is what a line
 * view has and the question is *which lines* — the `changed` frame names the
 * file, never the line. Comparing also covers the no-op refetch for free: the
 * same lines in a new array flash nothing.
 *
 * `identity` is what the lines are lines *of*. While it stays the same, a new
 * `lines` is an update and is compared; when it changes — another file, a
 * mode whose rows mean something else — the new lines are a fresh baseline
 * and nothing flashes. `null` turns the whole thing off, for a view that can
 * never change (a commit's file or diff), so switching from one commit to
 * another does not read as an edit.
 *
 * The first lines seen after mount are a baseline too: opening a tab, or
 * coming back to one, is not a change.
 */
export function useChangedLines(
  identity: string | null,
  lines: readonly string[] | null,
): LineFlash | null {
  const seen = useRef<{ identity: string | null; lines: readonly string[] | null }>({
    identity: null,
    lines: null,
  });
  const [flash, setFlash] = useState<{ lines: ReadonlySet<number>; seq: number } | null>(null);
  // Counts for the life of the mount rather than restarting when a flash is
  // cleared: a clear and a new update batched into one render would otherwise
  // hand a line the class it already had, and its fade would not restart.
  const seq = useRef(0);

  // Layout, so the flash is on the first paint of the new content rather than
  // one frame after it.
  useLayoutEffect(() => {
    const prev = seen.current;
    seen.current = { identity, lines };
    if (identity === null || lines === null) {
      setFlash(null);
      return;
    }
    if (prev.identity !== identity || prev.lines === null) {
      setFlash(null);
      return;
    }
    if (prev.lines === lines) return;
    const changed = changedLines(prev.lines, lines);
    if (changed.length === 0) return;
    setFlash({ lines: new Set(changed), seq: ++seq.current });
  }, [identity, lines]);

  // Dropped once the fade is over, so a later re-render that reuses a row for
  // another line — a scroll, an expansion — does not hand it a class.
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), PULSE_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  if (!flash) return null;
  return { lines: flash.lines, className: flashClass(flash.seq) };
}
