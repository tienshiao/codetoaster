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
        // A string is a short machine value — `91×45`, `2 viewing` — and is
        // pinned; anything the caller had to build a node for is the one that
        // may be long, and is the one allowed to lose characters.
        //
        // The distinction has to be made *somewhere*, and per-item is the only
        // place it can be: a flex child's default `min-width: auto` refuses to
        // shrink below its content, so without `min-w-0` one long working
        // directory pushes the grid size off the end of the bar — but with
        // `min-w-0` on everything the deficit is shared out in proportion to
        // content width, so a tight bar truncates `2 viewing` into `2 view…`
        // as well. Pinning the strings gets both: the long item absorbs the
        // whole squeeze, and it is the one carrying a `title`.
        <span key={i} className={typeof it === "string" ? "flex-none" : "min-w-0 truncate"}>
          {it}
        </span>
      ))}
      {right ? <span className="ml-auto">{right}</span> : null}
    </div>
  );
}
