import type { ReactNode } from "react";
import { Fact, HoverCardShell } from "@/frontend/components/v2/HoverCardParts";
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
 * The same conventions as `TaskHoverCard`, and from the same component: the
 * delays, the pointer test and the panel are `HoverCardShell`'s, so this file
 * is the commit's projection onto it and nothing else. It takes no clicks and
 * no focus — the row underneath stays the thing being pointed at.
 */
export function CommitHoverCard({ commit, children, open }: CommitHoverCardProps) {
  return (
    <HoverCardShell
      open={open}
      card={
        <>
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
        </>
      }
    >
      {children}
    </HoverCardShell>
  );
}
