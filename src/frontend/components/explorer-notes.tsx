import type { ReactNode } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/frontend/components/v2";

/**
 * What a section draws when it has nothing to draw: loading, empty, failed.
 *
 * They live here rather than in `Explorer.tsx` because the sections are files
 * of their own now (TASK-85's `BacklogSection` is the first), and a section
 * importing its empty state back out of the file that renders it would be a
 * cycle.
 */

/** The panel is 272px wide, so a state says what it is in one line rather than
 * centring a paragraph. */
export function ExplorerNote({ children }: { children: ReactNode }) {
  return <div className="px-2 py-3 text-xs text-subtle-foreground">{children}</div>;
}

export function ExplorerLoading({ children }: { children: ReactNode }) {
  return (
    <ExplorerNote>
      <span className="inline-flex items-center gap-1.5">
        <Loader2 size={12} className="animate-spin" />
        {children}
      </span>
    </ExplorerNote>
  );
}

export function ExplorerError({ children, onRetry }: { children: ReactNode; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start">
      <ExplorerNote>{children}</ExplorerNote>
      <div className="px-2 pb-2">
        <Button variant="outline" size="sm" icon={RefreshCw} onClick={onRetry}>
          Retry
        </Button>
      </div>
    </div>
  );
}
