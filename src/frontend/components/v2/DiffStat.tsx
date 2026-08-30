import { cn } from "@/frontend/lib/utils";

export interface DiffStatProps {
  additions?: number;
  deletions?: number;
  /** Omit to show just the two counts. */
  files?: number;
  /** Any CSS font-size; callers step it up inside commit detail headers. */
  size?: string;
  className?: string;
}

export function DiffStat({
  additions = 0,
  deletions = 0,
  files,
  size = "var(--text-micro)",
  className,
}: DiffStatProps) {
  return (
    <span
      style={{ fontSize: size }}
      className={cn(
        "inline-flex items-center gap-[5px] whitespace-nowrap font-mono tracking-mono",
        className,
      )}
    >
      {additions ? <span className="text-diff-add-marker">+{additions}</span> : null}
      {/* A true minus, not a hyphen — the one unicode substitution chrome allows. */}
      {deletions ? <span className="text-diff-del-marker">−{deletions}</span> : null}
      {files != null ? <span className="text-subtle-foreground">· {files} files</span> : null}
    </span>
  );
}
