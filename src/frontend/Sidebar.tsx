import { Link } from "@tanstack/react-router";
import { buildSessionSlug } from "./utils/slug";

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
  onNewTab: () => void;
  onCloseTab: (id: string) => void;
}

export function Sidebar({
  sessions,
  currentSessionId,
  onNewTab,
  onCloseTab,
}: SidebarProps) {
  return (
    <div className="sidebar">
      <div className="sidebar-header">CodeToaster</div>
      <div className="tab-list">
        {sessions.map((session) => (
          <Link
            key={session.id}
            to="/sessions/$slug"
            params={{ slug: buildSessionSlug(session) }}
            className={`tab-item ${session.exited ? "exited" : ""}`}
            activeProps={{ className: `tab-item active ${session.exited ? "exited" : ""}` }}
          >
            <span className="tab-item-label">
              <span className="tab-item-name">
                {session.name}
                {session.exited && <span className="tab-exited-badge">(exited)</span>}
              </span>
              {session.title && <span className="tab-item-title">{session.title}</span>}
            </span>
            <button
              className="tab-close-btn"
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
      <button className="new-tab-btn" onClick={onNewTab}>
        + New Tab
      </button>
    </div>
  );
}
