import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Sidebar } from "./Sidebar";
import { XTerminal } from "./Terminal";
import { useSession } from "./SessionContext";
import { buildSessionSlug } from "./utils/slug";
import "./index.css";

export function SessionLayout() {
  const {
    sessions,
    currentSessionId,
    isConnected,
    terminalRef,
    createSession,
    closeSession,
    handleTerminalReady,
    handleSizeChange,
    handleSendMessage,
  } = useSession();
  const navigate = useNavigate();

  const handleNewTab = useCallback(() => {
    const { id, name } = createSession();
    navigate({
      to: "/sessions/$slug",
      params: { slug: buildSessionSlug({ id, name }) },
    });
  }, [createSession, navigate]);

  const handleCloseTab = useCallback(
    (id: string) => {
      const remaining = sessions.filter((s) => s.id !== id);
      closeSession(id);

      if (id === currentSessionId) {
        if (remaining.length > 0) {
          const next = remaining[0]!;
          navigate({
            to: "/sessions/$slug",
            params: { slug: buildSessionSlug(next) },
          });
        } else {
          navigate({ to: "/" });
        }
      }
    },
    [sessions, currentSessionId, closeSession, navigate],
  );

  return (
    <div className="app-container">
      <Sidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        onNewTab={handleNewTab}
        onCloseTab={handleCloseTab}
      />
      <div className="terminal-area">
        <XTerminal
          ref={terminalRef}
          onSizeChange={handleSizeChange}
          onReady={handleTerminalReady}
          sendMessage={handleSendMessage}
        />
        {!isConnected && (
          <div className="terminal-overlay">Connecting...</div>
        )}
        {isConnected && !currentSessionId && (
          <div className="terminal-overlay">
            <div className="empty-state">
              <p>No active sessions</p>
              <button className="empty-state-btn" onClick={handleNewTab}>
                + New Session
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default SessionLayout;
