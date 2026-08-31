import { Archive, ArrowUp, FilePen, GitBranch } from "lucide-react";
import { StatusDot, type TaskState } from "./StatusDot";
import { cn } from "@/frontend/lib/utils";

/**
 * What git says about a task's own checkout (§5.6).
 *
 * The same shape as the wire's `TaskWorktreeInfo`, restated here because the
 * design system does not import the transport's types — a row is drawn from
 * fixture data in the shell route as readily as from a socket frame.
 *
 * Every field is separately unknowable, and that is the point: `branch` is null
 * for a detached head, `dirty` is null when git could not be asked at all. A
 * row shows only what it has.
 */
export interface TaskRowWorktreeFacts {
  branch: string | null;
  dirty: number | null;
  unpushed: number;
  merged: boolean;
}

export interface TaskRowProps {
  title: string;
  state?: TaskState;
  /** Second line: the last thing the agent said. */
  preview?: string;
  /** Trailing mono value — age, diff stat, whatever the list is sorted on. */
  meta?: string;
  selected?: boolean;
  /** Nested under a ProjectGroup header; off for a flat, ungrouped list. */
  indent?: boolean;
  /** The task has a checkout of its own. Drawn as the branch glyph in the
   * title line's trailing column, where it stays put whether or not anything
   * about that checkout has been measured yet — a mark that moves between rows
   * is a mark that cannot be scanned. */
  worktree?: boolean;
  /**
   * What git currently says about that checkout, or absent while it has not
   * been measured.
   *
   * Absent is **not** "nothing to report": these cost git processes, so the
   * server sends the row first and the facts when it has them, and a row that
   * drew `0 dirty` in the meantime would be stating a fact nobody established.
   * Nothing here is rendered as a zero — a count is drawn only when it is both
   * known and non-zero, which also keeps a clean checkout from carrying a line
   * of noise saying so.
   */
  worktreeFacts?: TaskRowWorktreeFacts | null;
  onClick?: () => void;
  className?: string;
}

/** Whether the facts amount to anything worth a line of the row. A measured,
 * clean, unmoved checkout says nothing here: the branch glyph on the title line
 * already says there is one. */
function worthShowing(facts: TaskRowWorktreeFacts): boolean {
  return Boolean(facts.branch) || (facts.dirty ?? 0) > 0 || facts.unpushed > 0 || facts.merged;
}

/**
 * The checkout's line: branch, then the counts, right-aligned under the row's
 * `meta` column.
 *
 * Icons and digits rather than words because this is the third line of a row in
 * a 240px column — "3 uncommitted files" does not fit beside a branch name, and
 * the words are carried by the title/aria-label for anyone who needs them. The
 * whole line is `text-subtle-foreground`: the row's one piece of colour is its
 * status dot, and a list of thirty stays scannable only if that stays true.
 */
function WorktreeLine({ facts }: { facts: TaskRowWorktreeFacts }) {
  // `dirty: null` is "git could not be asked", which is exactly as absent as a
  // zero is uninteresting — neither draws.
  const dirty = facts.dirty != null && facts.dirty > 0 ? facts.dirty : null;
  const unpushed = facts.unpushed > 0 ? facts.unpushed : null;

  return (
    <span className="flex items-center gap-1.5 text-micro text-subtle-foreground">
      {/* Always rendered, empty branch included: with `flex-1` it is also the
          spacer that holds the counts against the trailing edge, so they sit in
          the same column whether or not the branch is known. */}
      <span className="min-w-0 flex-1 truncate font-mono tracking-mono">{facts.branch ?? ""}</span>
      {dirty !== null ? (
        <span
          className="flex flex-none items-center gap-px font-mono tracking-mono"
          title={`${dirty} uncommitted file${dirty === 1 ? "" : "s"}`}
          aria-label={`${dirty} uncommitted file${dirty === 1 ? "" : "s"}`}
        >
          <FilePen size={10} aria-hidden="true" />
          {dirty}
        </span>
      ) : null}
      {unpushed !== null ? (
        <span
          className="flex flex-none items-center gap-px font-mono tracking-mono"
          title={`${unpushed} unpushed commit${unpushed === 1 ? "" : "s"}`}
          aria-label={`${unpushed} unpushed commit${unpushed === 1 ? "" : "s"}`}
        >
          <ArrowUp size={10} aria-hidden="true" />
          {unpushed}
        </span>
      ) : null}
      {facts.merged ? (
        // The 'archive?' nudge (§5.6). One 10px glyph in the success tone —
        // enough to be found when scanning for finished work, not enough to
        // compete with the status dot. It is a suggestion, not a state: the
        // task is still perfectly usable, so nothing about the row dims.
        <Archive
          size={10}
          className="flex-none text-success"
          aria-label="merged into its base — archive?"
        />
      ) : null}
    </span>
  );
}

export function TaskRow({
  title,
  state = "idle",
  preview,
  meta,
  selected = false,
  indent = true,
  worktree = false,
  worktreeFacts,
  onClick,
  className,
}: TaskRowProps) {
  const dim = state === "suspended" || state === "exited";
  const facts = worktreeFacts && worthShowing(worktreeFacts) ? worktreeFacts : null;
  // Anything below the title makes the row a stack, and the trailing column has
  // to align to the first line rather than to the middle of all of them.
  const stacked = Boolean(preview) || facts !== null;
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      // 21px lines the dot up under a group header's chevron; no spacing step
      // lands there.
      style={indent ? { paddingLeft: 21 } : undefined}
      className={cn(
        "flex min-h-row w-full cursor-pointer gap-[9px] rounded-md px-2 text-left",
        "transition-[background-color] duration-[var(--duration-instant)] ease-[var(--ease-out)]",
        "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
        stacked ? "items-start py-[5px]" : "items-center",
        selected
          ? "bg-selected text-selected-foreground shadow-[inset_0_0_0_1px_var(--selected-border)]"
          : cn("hover:bg-hover", dim ? "text-muted-foreground" : "text-sidebar-foreground"),
        className,
      )}
    >
      <StatusDot state={state} className={stacked ? "mt-[5px]" : undefined} />
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span
          className={cn(
            "truncate",
            selected || state === "busy" || state === "attention" ? "font-medium" : "font-normal",
          )}
        >
          {title}
        </span>
        {preview ? <span className="truncate text-xs text-subtle-foreground">{preview}</span> : null}
        {facts ? <WorktreeLine facts={facts} /> : null}
      </span>
      {worktree ? (
        <GitBranch
          size={11}
          className={cn("flex-none text-subtle-foreground", stacked && "mt-[5px]")}
        />
      ) : null}
      {meta ? (
        <span
          className={cn(
            "flex-none font-mono text-micro tracking-mono text-subtle-foreground",
            stacked && "mt-1",
          )}
        >
          {meta}
        </span>
      ) : null}
    </button>
  );
}
