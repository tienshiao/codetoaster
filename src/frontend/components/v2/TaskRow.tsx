import { GitBranch } from "lucide-react";
import { StatusDot, type TaskState } from "./StatusDot";
import { cn } from "@/frontend/lib/utils";

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
  worktree?: boolean;
  onClick?: () => void;
  className?: string;
}

export function TaskRow({
  title,
  state = "idle",
  preview,
  meta,
  selected = false,
  indent = true,
  worktree = false,
  onClick,
  className,
}: TaskRowProps) {
  const dim = state === "suspended" || state === "exited";
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
        preview ? "items-start py-[5px]" : "items-center",
        selected
          ? "bg-selected text-selected-foreground shadow-[inset_0_0_0_1px_var(--selected-border)]"
          : cn("hover:bg-hover", dim ? "text-muted-foreground" : "text-sidebar-foreground"),
        className,
      )}
    >
      <StatusDot state={state} className={preview ? "mt-[5px]" : undefined} />
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
      </span>
      {worktree ? (
        <GitBranch
          size={11}
          className={cn("flex-none text-subtle-foreground", preview && "mt-[5px]")}
        />
      ) : null}
      {meta ? (
        <span
          className={cn(
            "flex-none font-mono text-micro tracking-mono text-subtle-foreground",
            preview && "mt-1",
          )}
        >
          {meta}
        </span>
      ) : null}
    </button>
  );
}
