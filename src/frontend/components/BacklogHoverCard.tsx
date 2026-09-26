import type { ReactNode } from "react";
import { Fact, HoverCardBody, HoverCardShell } from "@/frontend/components/v2";
import type { BacklogTask } from "@/types/backlog";

export interface BacklogHoverCardProps {
  task: BacklogTask;
  /** The row, as a single DOM element. Radix anchors the card to it through
   * `asChild`, so it must be an element with a ref to take. */
  children: ReactNode;
  /** Controlled open state. Only tests pass this; the pointer owns it in the
   * app. */
  open?: boolean;
}

/**
 * What a Backlog card could not fit (TASK-114).
 *
 * The row is an id, a truncated title and a line of chips, and in the
 * Explorer's 272px panel the title is cut off for most tasks while the
 * assignee, the dates, the description and how far along the criteria are
 * never appear at all — so finding one task meant opening files one by one.
 * The card is the title whole, the description under it, and a fact for each
 * thing the task actually has.
 *
 * The same conventions as `CommitHoverCard` and `TaskHoverCard`, and from the
 * same component: the delays, the pointer test and the panel are
 * `HoverCardShell`'s, so this file is the backlog task's projection onto it and
 * nothing else. A fact the task lacks is left out rather than drawn empty — a
 * label with nothing beside it reads as "unknown", when it means "none".
 */
export function BacklogHoverCard({ task, children, open }: BacklogHoverCardProps) {
  const { done, total } = task.acceptance;
  return (
    <HoverCardShell
      open={open}
      card={
        <>
          <span className="font-medium break-words">
            {/* `font-normal`: the id sits inside the title's `font-medium` span
                and would otherwise inherit its weight, where the row draws it
                light. */}
            <span className="mr-1.5 font-mono font-normal text-micro tracking-mono text-subtle-foreground">
              {task.id}
            </span>
            {task.title}
          </span>
          {/* As written, markdown and all: the descriptions are prose with the
              odd backtick, and the rendered file is one click away. */}
          {task.description ? <HoverCardBody>{task.description}</HoverCardBody> : null}
          <dl className="flex flex-col gap-1 text-micro">
            <Fact label="Status">{task.status}</Fact>
            {task.priority ? <Fact label="Priority">{task.priority}</Fact> : null}
            {task.assignee.length > 0 ? (
              <Fact label="Assignee">{task.assignee.join(", ")}</Fact>
            ) : null}
            {task.labels.length > 0 ? <Fact label="Labels">{task.labels.join(", ")}</Fact> : null}
            {task.parent ? (
              <Fact label="Parent">
                <span className="font-mono tracking-mono">{task.parent}</span>
              </Fact>
            ) : null}
            {task.dependencies.length > 0 ? (
              <Fact label="Deps">
                <span className="font-mono tracking-mono">{task.dependencies.join(", ")}</span>
              </Fact>
            ) : null}
            {total > 0 ? (
              <Fact label="Criteria">
                {done}/{total} done
              </Fact>
            ) : null}
            {/* As written: the file carries no timezone, so there is no instant
                to render relative to — the string is the most honest form. */}
            {task.createdDate ? <Fact label="Created">{task.createdDate}</Fact> : null}
            {task.updatedDate ? <Fact label="Updated">{task.updatedDate}</Fact> : null}
          </dl>
        </>
      }
    >
      {children}
    </HoverCardShell>
  );
}
