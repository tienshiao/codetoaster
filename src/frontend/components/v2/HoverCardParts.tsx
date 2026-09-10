import type { ReactNode } from "react";
import { cn } from "@/frontend/lib/utils";

/**
 * The chrome every hover card shares (TASK-97, TASK-102).
 *
 * A card is a second look at a row, and two of them drawn differently would
 * read as two different mechanisms rather than one convention — so the panel
 * and the fact block live here and the cards supply only their content.
 */

export const HOVER_CARD_CONTENT_CLASS = cn(
  "z-50 flex w-72 flex-col gap-2 rounded-md border border-border bg-pane p-3",
  "font-sans text-sm leading-ui tracking-ui text-foreground shadow-overlay",
  // Display-only, and enforced rather than promised (TASK-97 AC #5). The card
  // hangs over the pane beside the sidebar, where a click is meant for whatever
  // is underneath it — a terminal, a diff — and an invisible sheet of glass
  // over that would be a worse bug than the card is a feature. Nothing in here
  // is interactive, so nothing is lost: the cost is that the card cannot be
  // hovered onto to keep it open, which is why nothing in it is a control.
  "pointer-events-none select-none",
);

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
