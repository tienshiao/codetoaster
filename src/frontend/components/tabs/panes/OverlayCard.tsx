import type { ReactNode } from "react";
import { cn } from "@/frontend/lib/utils";

/**
 * The pill a pane floats over its terminal.
 *
 * What it is not allowed to be is *off the system*, which the reopen overlay
 * once was: the only `rounded-full` chrome in the app, over a `bg-pane/95` and
 * a raw `shadow-lg`, with a hand-set button height. It floats; it still uses
 * the same radius, surface and shadow as everything else — and now from one
 * place, so the next pane that needs one cannot drift off it again.
 *
 * Click-through except for the pill itself, which is there to be clicked.
 *
 * **Placement is a convention, not a choice per pane.** The reopen overlay owns
 * the top; the drop failure owns the bottom. They can be on screen at once —
 * the drop that always fails is the one made onto a suspended task, while the
 * reopen pill is showing — and two pills stacked in the same place would hide
 * one another.
 */
export function OverlayCard({
  side,
  role,
  children,
  className,
}: {
  side: "top" | "bottom";
  /** For a pill that is an announcement rather than chrome — `"alert"` on the
   * drop failure, so it is read out when it appears. */
  role?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 z-20 flex justify-center",
        side === "top" ? "top-3" : "bottom-3",
      )}
    >
      <div
        role={role}
        className={cn(
          "pointer-events-auto flex items-center gap-3 rounded-md border border-border",
          "bg-pane py-1.5 pl-3 pr-1.5 text-sm text-muted-foreground shadow-overlay",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * The cause, trailing the sentence that names what failed.
 *
 * Truncated by the card rather than by us: a network error can be a paragraph,
 * and the words in front of it are the part that must stay readable.
 *
 * `inline-block` and not a bare `inline`, which is what this was: `max-width`
 * and `overflow` do not apply to an inline box at all, so only the `nowrap` in
 * `truncate` took effect and a long message pushed the pill wider instead of
 * ellipsising inside it.
 */
export function OverlayCause({ children }: { children: ReactNode }) {
  return (
    <span className="ml-2 inline-block max-w-[28ch] truncate align-bottom text-subtle-foreground">
      {children}
    </span>
  );
}
