import { StatusDot } from "./components/StatusDot";
import { SidebarTrigger } from "./components/ui/sidebar";

interface TopBarProps {
  isConnected: boolean;
  isExited: boolean;
  isActive: boolean;
  hasNotification: boolean;
  hasSession: boolean;
  name: string | undefined;
  title: string | undefined;
}

export function TopBar({ isConnected, isExited, isActive, hasNotification, hasSession, name, title }: TopBarProps) {
  return (
    <div className="flex items-center gap-2 px-3 h-10 min-h-10 bg-zinc-900 border-b border-zinc-800 text-xs text-zinc-400">
      <SidebarTrigger className="-ml-1" />
      {hasSession && <StatusDot isConnected={isConnected} isExited={isExited} isActive={isActive} hasNotification={hasNotification} />}
      {name && <span className="shrink-0">{name}</span>}
      {name && title && <span className="text-zinc-600">—</span>}
      {title && <span className="truncate">{title}</span>}
    </div>
  );
}
