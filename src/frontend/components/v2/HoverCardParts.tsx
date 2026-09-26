import type { ReactNode } from "react";
import { HoverCard } from "radix-ui";
import { cn } from "@/frontend/lib/utils";
import {
  useHoverPointer,
  HOVER_OPEN_DELAY,
  HOVER_CLOSE_DELAY,
} from "@/frontend/hooks/use-hover-pointer";

/**
 * The chrome every hover card shares (TASK-97, TASK-102).
 *
 * A card is a second look at a row, and two of them drawn differently would
 * read as two different mechanisms rather than one convention — so the panel,
 * the fact block and the whole Radix arrangement live here and the cards supply
 * only their content.
 */

const HOVER_CARD_CONTENT_CLASS = cn(
  // z-40, one layer under everything else that floats. A hover card is
  // display-only, a second look at a row, so it sits under every other floating
  // surface: menus, selects, the command palette and dialogs all stay at 50.
  // That is what makes mount order irrelevant. At 50 alongside them it was a
  // tie broken by whichever portal reached `document.body` last, and a card
  // whose open timer fired after a dialog's scrim had mounted painted above the
  // shade (TASK-115).
  "z-40 flex w-72 flex-col gap-2 rounded-md border border-border bg-pane p-3",
  "font-sans text-sm leading-ui tracking-ui text-foreground shadow-overlay",
  // Display-only, and enforced rather than promised (TASK-97 AC #5). The card
  // hangs over the pane beside the sidebar, where a click is meant for whatever
  // is underneath it — a terminal, a diff — and an invisible sheet of glass
  // over that would be a worse bug than the card is a feature. Nothing in here
  // is interactive, so nothing is lost: the cost is that the card cannot be
  // hovered onto to keep it open, which is why nothing in it is a control.
  "pointer-events-none select-none",
);

export interface HoverCardShellProps {
  /** Controlled open state. Only tests pass this; the pointer owns it in the
   * app. */
  open?: boolean;
  /** What goes in the panel. An element rather than a render prop, and it is
   * only *mounted* while the card is open — Radix's portal draws nothing
   * otherwise, which is what keeps a sidebar of thirty rows thirty rows. */
  card: ReactNode;
  /** The row, as a single DOM element. Radix anchors the card to it through
   * `asChild`, so it must be an element with a ref to take — a component that
   * merely renders one is not enough. */
  children: ReactNode;
}

/**
 * The arrangement itself: pointer test, delays, trigger, portal, panel.
 *
 * Radix underneath, for the parts a floating panel is judged on and that are
 * tedious to get right by hand: the open/close delays with their grace area,
 * flipping and shifting to stay on screen, and a portal so a scrolling list's
 * own `overflow-y-auto` does not clip it. Every card gets all of that from
 * here, so none of them can drift from the others by being written out again.
 */
export function HoverCardShell({ open, card, children }: HoverCardShellProps) {
  const hoverable = useHoverPointer();
  // The row, and nothing around it, on a device that cannot hover: Radix's
  // trigger calls `preventDefault()` on `touchstart`, which would eat the tap
  // that selects the row underneath. See `useHoverPointer`. Everything a card
  // says is reachable without it, which is the standing rule for a hover card
  // and what makes leaving it out a choice rather than a loss.
  if (!hoverable) return <>{children}</>;

  return (
    <HoverCard.Root open={open} openDelay={HOVER_OPEN_DELAY} closeDelay={HOVER_CLOSE_DELAY}>
      {/* `asChild`: the row stays the element the list laid out, with its own
          classes and its own `onClick` — the card wraps the row, it does not
          replace it, and nothing about its box changes for having a card. */}
      {/* Not on focus. Radix opens the card when its trigger gains focus, and
          the row's own controls sit inside the trigger: a dialog handing focus
          back to the archive icon on close (TASK-115) opened the card anchored
          to a row the pointer had long left, and it stayed until something else
          took focus. `preventDefault` here is what Radix checks before its own
          handler runs. A hover card is a pointer affordance — everything on it
          is reachable elsewhere, which is the standing rule — so keyboard focus
          was never a way in that anyone was promised. Blur still closes it. */}
      <HoverCard.Trigger asChild onFocus={(event) => event.preventDefault()}>
        {children}
      </HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          // Off the rail and into the pane: the lists these hang off are narrow,
          // and a card above or below one would cover its neighbours — the rows
          // you are reading this one against.
          side="right"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className={HOVER_CARD_CONTENT_CLASS}
        >
          {card}
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}

/**
 * The long text under a card's title — a commit body, a task's description.
 *
 * Wrapped, and clamped rather than cut: the text can run to a page, and a card
 * taller than the panel covers the list it is describing. The tail is one
 * click away in the row's own tab. One block for every card, so the clamp
 * height is a single decision.
 */
export function HoverCardBody({ children }: { children: ReactNode }) {
  return (
    <p className="max-h-48 overflow-hidden whitespace-pre-wrap break-words text-xs text-subtle-foreground">
      {children}
    </p>
  );
}

/** One `dt`/`dd` pair of the fact block. The label column is fixed so the
 * values line up: this is read down the left edge. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-[52px] flex-none text-subtle-foreground">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}
