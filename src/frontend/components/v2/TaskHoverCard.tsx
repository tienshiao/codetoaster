import { useState, type ReactNode } from "react";
import { StatusDot, type TaskState } from "./StatusDot";
import { WorktreeMarks } from "./TaskRow";
import { absoluteTime, agoLabel } from "@/frontend/utils/taskTimes";
import { Fact, HoverCardShell } from "./HoverCardParts";

/**
 * Everything a 240px row had to throw away (TASK-97).
 *
 * Plain data, and restated here rather than imported from the wire for the
 * reason `TaskRowWorktreeFacts` gives next door: the design system draws a card
 * from fixture data as readily as from a socket frame, and nothing here is
 * allowed to know what a `TaskInfo` is.
 *
 * Every optional field is optional because it is genuinely unknowable, not
 * because a caller might be lazy. A card draws a line only for what it has —
 * `dirty: null` is "git could not be asked", which is exactly as absent as a
 * zero is uninteresting, and neither is written down.
 */
export interface TaskRowDetails {
  /** The row's label, untruncated — the whole point of the card. */
  title: string;
  /** The last thing the agent said, in full. */
  preview?: string;
  /** What the program inside is calling itself (OSC 0/2). Drawn only when it
   * says something neither of the two above already does: once a title has
   * been promoted to the label, repeating it is noise. */
  terminalTitle?: string;
  project?: string;
  state: TaskState;
  /** Why the state is not quite the state — "inferred from output" for a task
   * whose profile cannot report hooks (TASK-89.4). The row can only fit this
   * in the dot's tooltip; here it fits in words. */
  stateNote?: string;
  /** Where the work is: the task's checkout when it has one, else the
   * directory its terminal is in. */
  path?: string;
  /**
   * The task's own checkout, in three answers rather than two.
   *
   * `undefined` is "this task has no checkout of its own" — it runs in the
   * project's directory, and there is no branch of ours to name. `null` is "it
   * has one, on a detached head", which is an answer and not a gap. A string is
   * the branch. The card draws a Branch line for the last two and none for the
   * first, so the difference has to be carried rather than collapsed.
   */
  branch?: string | null;
  /** Uncommitted files, or null when git could not be asked. */
  dirty?: number | null;
  unpushed?: number;
  merged?: boolean;
  /** The agent profile, when it is not the one every task would have had
   * anyway. The caller decides what its default is; the card draws whatever it
   * is handed. */
  profile?: string;
  createdAt: number;
  lastActiveAt: number;
  /** Clients attached right now. Zero is the ordinary case — nobody has the
   * task open — and says nothing worth a line. */
  viewers?: number;
  /** Archived (§5.6). Its checkout is gone, so the card says so instead of
   * describing a branch that is no longer on disk. */
  archived?: boolean;
}

export interface TaskHoverCardProps {
  /** Absent for a row that has nothing more to say than it already shows —
   * the fixture rows in the shell route, and anything drawn without a task
   * behind it. */
  details?: TaskRowDetails;
  /** The row, as a single DOM element. Radix anchors the card to it through
   * `asChild`, so it must be an element with a ref to take — a component that
   * merely renders one is not enough. */
  children: ReactNode;
  /** Controlled open state. Only tests pass this; the pointer owns it in the
   * app. */
  open?: boolean;
}

/** A relative reading and an absolute one, in that order: the first answers
 * "is this stale", the second "was that the Tuesday I was on this". */
function When({ at, now }: { at: number; now: number }) {
  return (
    <>
      <span>{agoLabel(at, now)}</span>{" "}
      <span className="text-subtle-foreground">{absoluteTime(at)}</span>
    </>
  );
}

/**
 * The checkout: branch, then whatever `WorktreeMarks` has to say about it.
 *
 * The branch is laid out here rather than in the shared component because the
 * card gives it room to wrap where the row truncates it. The glyphs after it
 * are the row's own, from `TaskRow`, and shared for the reason that component
 * states: a mark that meant one thing in the list and another here would have
 * to be learned twice.
 */
function Checkout({ details }: { details: TaskRowDetails }) {
  return (
    <span className="flex items-start gap-2">
      <span className="min-w-0 flex-1 break-all font-mono tracking-mono">
        {details.branch ?? "detached"}
      </span>
      <WorktreeMarks
        dirty={details.dirty}
        unpushed={details.unpushed}
        merged={details.merged}
      />
    </span>
  );
}

function Card({ details }: { details: TaskRowDetails }) {
  // Frozen at the moment the card opens. The card is mounted by the hover and
  // thrown away after it, so there is nothing here that has to keep ticking —
  // and it would otherwise: the sidebar rebuilds its `details` objects on every
  // task delta, so an open card re-renders while it is being read, and a plain
  // `Date.now()` would move the age under the pointer.
  const [now] = useState(() => Date.now());
  const { title, preview, terminalTitle, state, stateNote, archived } = details;
  // The terminal title earns a line only by saying something new. It is the
  // row's fallback preview and often its label as well, so on most tasks it is
  // a third copy of something already on the card.
  const terminal =
    terminalTitle && terminalTitle !== title && terminalTitle !== preview ? terminalTitle : null;
  // Two rules. An archived task's checkout has been removed, so describing its
  // branch or counting files in it would be naming something that is not on
  // disk — the same rule the row follows by suppressing its checkout line. And
  // for the rest, `branch !== undefined` rather than a truthiness test: null is
  // a detached head, which is a checkout with something to say, while undefined
  // is a task that has none at all. The counts are read by the same rules
  // `WorktreeMarks` draws them by, so the line can never come out empty.
  const checkout =
    !archived &&
    (details.branch !== undefined ||
      (details.dirty ?? 0) > 0 ||
      (details.unpushed ?? 0) > 0 ||
      Boolean(details.merged));

  return (
    <>
      <div className="flex items-start gap-2">
        <StatusDot
          state={state}
          title={stateNote ? `${state} · ${stateNote}` : undefined}
          className="mt-[6px]"
        />
        <span className="min-w-0 flex-1 font-medium">{title}</span>
      </div>
      {preview ? (
        // Wrapped, and clamped rather than cut: a `Stop` hook message can be a
        // paragraph, and a card taller than the sidebar is a card that covers
        // the thing it is describing.
        <p className="line-clamp-6 whitespace-pre-wrap break-words text-xs text-subtle-foreground">
          {preview}
        </p>
      ) : null}
      {terminal ? <p className="truncate text-xs text-subtle-foreground">{terminal}</p> : null}
      <dl className="flex flex-col gap-1 text-micro">
        {details.project ? <Fact label="Project">{details.project}</Fact> : null}
        {details.path ? (
          // Broken anywhere rather than truncated: a worktree path ends in the
          // two ids that identify it, and a tail is the half that matters.
          <Fact label="Path">
            <span className="break-all font-mono tracking-mono">{details.path}</span>
          </Fact>
        ) : null}
        {checkout ? (
          <Fact label="Branch">
            <Checkout details={details} />
          </Fact>
        ) : null}
        <Fact label="State">
          {archived ? "archived" : state}
          {!archived && stateNote ? (
            <span className="text-subtle-foreground"> · {stateNote}</span>
          ) : null}
        </Fact>
        {details.profile ? <Fact label="Profile">{details.profile}</Fact> : null}
        {details.viewers ? (
          <Fact label="Viewers">{details.viewers} viewing</Fact>
        ) : null}
        <Fact label="Created">
          <When at={details.createdAt} now={now} />
        </Fact>
        <Fact label="Active">
          <When at={details.lastActiveAt} now={now} />
        </Fact>
      </dl>
    </>
  );
}

/**
 * What a task row could not fit, beside the sidebar (TASK-97).
 *
 * v1 put a terminal thumbnail here, which said nothing — thirty agents all
 * look the same at 200px. What the row actually loses is its *text*: the title
 * and the preview are truncated, the branch is truncated under them, and the
 * age is one coarse digit. So the card is those, untruncated, plus the facts a
 * row has no line for at all — where the task is, what it is running on, who
 * else has it open, when it started.
 *
 * Everything on it is reachable elsewhere, and deliberately: a hover card is
 * not an interface, it is a second look. Nothing in it is a control, it takes
 * no clicks and no focus, and it opens on a delay so that running the pointer
 * down the list opens nothing at all.
 *
 * The arrangement — the delays, the trigger, the portal, the panel — is
 * `HoverCardShell`'s, shared with the commit card; this component is only the
 * projection of a task onto it.
 */
export function TaskHoverCard({ details, children, open }: TaskHoverCardProps) {
  // The bare row for a task that was handed nothing to say. (The shell has the
  // other reason for drawing one: a device that cannot hover.)
  if (!details) return <>{children}</>;

  return (
    <HoverCardShell open={open} card={<Card details={details} />}>
      {children}
    </HoverCardShell>
  );
}
