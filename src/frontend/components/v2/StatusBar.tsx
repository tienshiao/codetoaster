import type { ReactNode } from "react";
import { StatusDot, type TaskState } from "./StatusDot";
import { cn } from "@/frontend/lib/utils";

export interface StatusBarProps {
  /** Omit for surfaces with no task behind them. */
  state?: TaskState;
  items?: ReactNode[];
  /** Pushed to the trailing edge — grid size, port, connection. */
  right?: ReactNode;
  className?: string;
}

export function StatusBar({ state, items = [], right, className }: StatusBarProps) {
  return (
    <div
      className={cn(
        "flex h-statusbar flex-none items-center gap-3 border-t border-border bg-chrome px-3",
        "font-mono text-micro tracking-mono text-muted-foreground",
        className,
      )}
    >
      {state ? (
        <span className="flex items-center gap-[5px]">
          <StatusDot state={state} size={6} />
          {state}
        </span>
      ) : null}
      {items.map((it, i) => (
        // `min-w-0` so an item that is too long loses its own characters rather
        // than pushing the ones after it off the bar. A flex child's default
        // `min-width: auto` refuses to shrink below its content, which is what
        // turns one long value — a task's working directory — into a bar that
        // silently stops showing the grid size. Nothing here is load-bearing
        // enough to be worth that, and the long ones carry a `title`.
        <span key={i} className="min-w-0 truncate">
          {it}
        </span>
      ))}
      {right ? <span className="ml-auto">{right}</span> : null}
    </div>
  );
}
