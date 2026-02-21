import { Link } from "@tanstack/react-router";
import { buildSessionSlug } from "./utils/slug";
import { StatusDot } from "./components/StatusDot";

export interface SessionInfo {
  id: string;
  name: string;
  title?: string;
  createdAt: number;
  size: { cols: number; rows: number };
  clientCount: number;
  exited?: boolean;
}

interface SidebarProps {
  sessions: SessionInfo[];
  currentSessionId: string | null;
  isConnected: boolean;
  sessionActivity: Record<string, boolean>;
  onNewTab: () => void;
  onCloseTab: (id: string) => void;
}

export function Sidebar({
  sessions,
  currentSessionId,
  isConnected,
  sessionActivity,
  onNewTab,
  onCloseTab,
}: SidebarProps) {
  return (
    <div className="w-[200px] min-w-[200px] h-full bg-[#1a1a1a] border-r border-zinc-700 flex flex-col">
      <div className="px-4 py-3 h-10 text-xs font-semibold uppercase tracking-wide text-zinc-500 border-b border-zinc-700">
        CodeToaster
      </div>
      <div className="flex-1 overflow-y-auto">
        {sessions.map((session) => (
          <Link
            key={session.id}
            to="/sessions/$slug"
            params={{ slug: buildSessionSlug(session) }}
            className="group flex items-center justify-between px-4 py-2.5 cursor-pointer border-b border-zinc-800 transition-colors duration-150 no-underline text-inherit hover:bg-zinc-800"
            activeProps={{
              className: "group flex items-center justify-between px-4 py-2.5 cursor-pointer border-b border-zinc-800 transition-colors duration-150 no-underline text-inherit hover:bg-zinc-800 bg-zinc-700 border-l-[3px] border-l-[#4a9eff] pl-[13px]",
            }}
          >
            <span className="flex flex-col overflow-hidden flex-1">
              <span className="text-[13px] overflow-hidden text-ellipsis whitespace-nowrap">
                {session.name}
              </span>
              {session.title && (
                <span className="text-[11px] text-zinc-500 overflow-hidden text-ellipsis whitespace-nowrap">
                  {session.title}
                </span>
              )}
            </span>
            <StatusDot
              isConnected={isConnected}
              isExited={!!session.exited}
              isActive={sessionActivity[session.id] ?? false}
              className="ml-2 group-hover:hidden"
            />
            <button
              className="hidden group-hover:flex items-center justify-center w-5 h-5 border-none bg-transparent text-zinc-500 cursor-pointer rounded text-sm leading-none p-0 ml-2 hover:bg-zinc-600 hover:text-white"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onCloseTab(session.id);
              }}
              title="Close session"
            >
              x
            </button>
          </Link>
        ))}
      </div>
      <button
        className="flex items-center justify-center gap-1.5 px-4 py-3 bg-transparent border-none border-t border-zinc-700 text-zinc-500 cursor-pointer text-[13px] transition-all duration-150 hover:bg-zinc-800 hover:text-white"
        onClick={onNewTab}
      >
        + New Tab
      </button>
    </div>
  );
}
