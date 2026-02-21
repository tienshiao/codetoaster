export interface SessionInfo {
  id: string;
  name: string;
  createdAt: number;
  size: { cols: number; rows: number };
  clientCount: number;
}

interface SidebarProps {
  sessions: SessionInfo[];
  currentSessionId: string | null;
  onSelectTab: (id: string) => void;
  onNewTab: () => void;
  onCloseTab: (id: string) => void;
}

export function Sidebar({
  sessions,
  currentSessionId,
  onSelectTab,
  onNewTab,
  onCloseTab,
}: SidebarProps) {
  return (
    <div className="sidebar">
      <div className="sidebar-header">Sessions</div>
      <div className="tab-list">
        {sessions.map((session) => (
          <div
            key={session.id}
            className={`tab-item ${session.id === currentSessionId ? "active" : ""}`}
            onClick={() => onSelectTab(session.id)}
          >
            <span className="tab-item-label">{session.name}</span>
            <button
              className="tab-close-btn"
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(session.id);
              }}
              title="Close session"
            >
              x
            </button>
          </div>
        ))}
      </div>
      <button className="new-tab-btn" onClick={onNewTab}>
        + New Tab
      </button>
    </div>
  );
}
