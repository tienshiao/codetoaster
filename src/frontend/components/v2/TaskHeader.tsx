import type { ReactNode } from "react";
import { cn } from "@/frontend/lib/utils";

/** The 28px band under a tab strip: what this task is, where it lives, and what
 * it is running. Everything but the title is machine-facing, hence mono. */
export interface TaskHeaderProps {
  title: string;
  path?: string;
  branch?: string;
  /** Model and permission mode, as a `Badge` or anything else small. */
  badge?: ReactNode;
  className?: string;
}

/**
 * Its own component because a split shows it more than once: each group carries
 * the header under its own strip, the way VSCode repeats breadcrumbs per editor
 * group, so the strip a user is looking at is always sitting on the pane it
 * controls.
 */
export function TaskHeader({ title, path, branch, badge, className }: TaskHeaderProps) {
  return (
    <div
      className={cn(
        "flex h-row flex-none items-center gap-2 border-b border-border bg-chrome px-3",
        "font-mono text-micro tracking-mono text-muted-foreground",
        className,
      )}
    >
      <span className="truncate font-sans text-xs tracking-ui text-foreground">{title}</span>
      {path && (
        <>
          <span className="flex-none text-border-strong">/</span>
          <span className="truncate">{path}</span>
        </>
      )}
      {branch && (
        <>
          <span className="flex-none text-border-strong">/</span>
          <span className="flex-none text-primary">{branch}</span>
        </>
      )}
      {badge && <span className="ml-auto flex-none">{badge}</span>}
    </div>
  );
}
