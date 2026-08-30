import { cn } from "@/frontend/lib/utils";

export type TaskState = "busy" | "idle" | "attention" | "suspended" | "exited" | "error";

export interface StatusDotProps {
  state?: TaskState;
  /** Edge length in px. 7 is the task-list dot; the status bar uses 6. */
  size?: number;
  /** Square (2px radius) instead of round — the diff/file-status marker. */
  square?: boolean;
  className?: string;
}

const FILLS: Record<TaskState, string> = {
  busy: "bg-state-busy",
  idle: "bg-state-idle",
  attention: "bg-state-attention",
  suspended: "bg-state-suspended",
  exited: "bg-state-exited",
  error: "bg-state-error",
};

export function StatusDot({ state = "idle", size = 7, square = false, className }: StatusDotProps) {
  return (
    <span
      title={state}
      style={{ width: size, height: size }}
      className={cn(
        "inline-block flex-none",
        square ? "rounded-sm" : "rounded-full",
        FILLS[state],
        // Attention gets a halo so it survives a list of thirty dots; busy
        // pulses instead, because "working" has to read as motion.
        state === "attention" &&
          "shadow-[0_0_0_3px_color-mix(in_oklab,var(--state-attention)_22%,transparent)]",
        state === "busy" && "animate-busy-pulse",
        className,
      )}
    />
  );
}
