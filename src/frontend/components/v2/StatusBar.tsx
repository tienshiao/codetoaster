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
        <span key={i}>{it}</span>
      ))}
      {right ? <span className="ml-auto">{right}</span> : null}
    </div>
  );
}
