import type { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/frontend/lib/utils";

export interface ProjectGroupProps {
  name: string;
  open?: boolean;
  /** Task count, shown right-aligned. Usually only worth it when collapsed. */
  count?: number;
  /** A task inside wants attention — surfaced so a collapsed group still says so. */
  attention?: boolean;
  onToggle?: () => void;
  className?: string;
  children?: ReactNode;
}

export function ProjectGroup({
  name,
  open = true,
  count,
  attention = false,
  onToggle,
  className,
  children,
}: ProjectGroupProps) {
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className={cn("flex flex-col gap-px", className)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={cn(
          "flex h-group w-full cursor-pointer items-center gap-[7px] rounded-md px-1.5 text-left",
          "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
          open ? "text-muted-foreground" : "text-subtle-foreground",
        )}
      >
        <Chevron size={11} className="flex-none" />
        <span className="truncate text-micro font-semibold uppercase tracking-label">{name}</span>
        {attention ? (
          <span className="size-[5px] flex-none rounded-full bg-state-attention" />
        ) : null}
        {count != null ? (
          <span className="ml-auto font-mono text-micro tracking-mono text-subtle-foreground">
            {count}
          </span>
        ) : null}
      </button>
      {open ? children : null}
    </div>
  );
}
