import { StatusDot } from "./components/StatusDot";

interface TopBarProps {
  isConnected: boolean;
  isExited: boolean;
  isActive: boolean;
  title: string | undefined;
}

export function TopBar({ isConnected, isExited, isActive, title }: TopBarProps) {
  return (
    <div className="flex items-center gap-2 px-3 h-10 min-h-10 bg-zinc-900 border-b border-zinc-800 text-xs text-zinc-400">
      <StatusDot isConnected={isConnected} isExited={isExited} isActive={isActive} />
      <span className="truncate">{title}</span>
    </div>
  );
}
