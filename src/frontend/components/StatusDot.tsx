import { useTrailingDebounce } from "../lib/useTrailingDebounce";

interface StatusDotProps {
  isConnected: boolean;
  isExited: boolean;
  isActive: boolean;
  className?: string;
}

export function StatusDot({ isConnected, isExited, isActive, className = "" }: StatusDotProps) {
  const visuallyActive = useTrailingDebounce(isActive, 2000);

  const dotClass = !isConnected || isExited
    ? "bg-red-400/70"
    : visuallyActive
      ? "bg-green-500/80 animate-pulse"
      : "bg-green-700/60";

  return <span className={`w-2 h-2 rounded-full shrink-0 ${dotClass} ${className}`} />;
}
