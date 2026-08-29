import { useDebounce } from "use-debounce";

interface StatusDotProps {
  isConnected: boolean;
  isExited: boolean;
  isActive: boolean;
  /** The task has no process behind it, and that is not a failure (§6): it was
   * closed or harvested and is one click from running again. Hollow rather than
   * filled, so it reads as dormant next to a live green and an exited red. */
  isSuspended?: boolean;
  /** Suspended, and the click that reopens it has already happened. */
  isResuming?: boolean;
  hasNotification?: boolean;
  className?: string;
}

export function StatusDot({
  isConnected,
  isExited,
  isActive,
  isSuspended = false,
  isResuming = false,
  hasNotification = false,
  className = "",
}: StatusDotProps) {
  const [visuallyActive] = useDebounce(isActive, 2000, { leading: true });

  // Ahead of the exited check, because a suspended task's terminal is gone by
  // definition and the two would otherwise fight over the same row: a closed
  // task would go on reading as a crashed one.
  if (isSuspended) {
    return (
      <span
        className={`w-2 h-2 rounded-full shrink-0 border border-zinc-500/70 bg-transparent ${isResuming ? "animate-pulse" : ""} ${className}`}
      />
    );
  }

  const dotClass = !isConnected || isExited
    ? "bg-red-400/70"
    : hasNotification
      ? "bg-amber-400"
      : visuallyActive
        ? "bg-green-500/80 animate-pulse"
        : "bg-green-700/60";

  if (hasNotification) {
    return (
      <span className={`relative inline-flex w-2 h-2 shrink-0 ${className}`}>
        <span className="absolute inset-0 rounded-full bg-amber-400 animate-ping" />
        <span className={`relative rounded-full w-2 h-2 ${dotClass}`} />
      </span>
    );
  }

  return <span className={`w-2 h-2 rounded-full shrink-0 ${dotClass} ${className}`} />;
}
