import type { ReactNode } from "react";
import { HoverCard } from "radix-ui";
import {
  useHoverPointer,
  HOVER_OPEN_DELAY,
  HOVER_CLOSE_DELAY,
} from "@/frontend/hooks/use-hover-pointer";
import { Fact, HOVER_CARD_CONTENT_CLASS } from "@/frontend/components/v2/HoverCardParts";
import { absoluteDate } from "../../utils/relativeDate";
import type { GitLogCommit } from "../../types/git";

export interface CommitHoverCardProps {
  commit: GitLogCommit;
  /** The row, as a single DOM element. Radix anchors the card to it through
   * `asChild`, so it must be an element with a ref to take. */
  children: ReactNode;
  /** Controlled open state. Only tests pass this; the pointer owns it in the
   * app. */
  open?: boolean;
}

/**
 * What a commit row could not fit (TASK-102).
 *
 * The row is a graph cell, some ref chips, a truncated subject and a date, and
 * in the Explorer's 272px panel the subject is cut off for nearly every commit
 * while the author and the sha are dropped from the row entirely. So the card
 * is the subject whole, the body under it, and the three facts the row has no
 * column for.
 *
 * The same conventions as `TaskHoverCard`, from the same module: the delays,
 * the pointer test, the panel and the fact block. It takes no clicks and no
 * focus — the row underneath stays the thing being pointed at.
 */
export function CommitHoverCard({ commit, children, open }: CommitHoverCardProps) {
  const hoverable = useHoverPointer();
  // The row and nothing around it, on a device that cannot hover: Radix's
  // trigger prevents `touchstart`, which would eat the tap that selects the
  // commit. See `useHoverPointer`.
  if (!hoverable) return <>{children}</>;

  return (
    <HoverCard.Root open={open} openDelay={HOVER_OPEN_DELAY} closeDelay={HOVER_CLOSE_DELAY}>
      {/* `asChild`: the row stays the element the virtualizer positioned, and
          keeps its own `onClick` — the card wraps the button, it does not
          replace it. */}
      <HoverCard.Trigger asChild>{children}</HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          // Off the rail and into the pane, like the task card: the list is
          // narrow and a card above or below it would cover the neighbouring
          // commits — the rows you are reading this one against.
          side="right"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className={HOVER_CARD_CONTENT_CLASS}
        >
          <span className="font-medium break-words">{commit.subject}</span>
          {commit.body ? (
            // Wrapped and clamped rather than cut: a message can be a page of
            // rationale, and a card taller than the panel covers the list it is
            // describing. The tail is one click away in the commit tab.
            <p className="max-h-48 overflow-hidden whitespace-pre-wrap break-words text-xs text-subtle-foreground">
              {commit.body}
            </p>
          ) : null}
          <dl className="flex flex-col gap-1 text-micro">
            <Fact label="SHA">
              <span className="font-mono tracking-mono">{commit.hash.slice(0, 8)}</span>
            </Fact>
            <Fact label="Author">{commit.author}</Fact>
            <Fact label="Date">{absoluteDate(commit.date)}</Fact>
          </dl>
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}
