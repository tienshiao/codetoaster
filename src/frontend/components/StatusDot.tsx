import { useDebounce } from "use-debounce";

interface StatusDotProps {
  isConnected: boolean;
  isExited: boolean;
  isActive: boolean;
  hasNotification?: boolean;
  className?: string;
}

export function StatusDot({ isConnected, isExited, isActive, hasNotification = false, className = "" }: StatusDotProps) {
  const [visuallyActive] = useDebounce(isActive, 2000, { leading: true });

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
