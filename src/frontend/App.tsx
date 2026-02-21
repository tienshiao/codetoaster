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
    <div className="flex w-full h-full">
      <Sidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        onNewTab={handleNewTab}
        onCloseTab={handleCloseTab}
      />
      <div className="flex-1 h-full overflow-hidden relative">
        <XTerminal
          ref={terminalRef}
          onSizeChange={handleSizeChange}
          onReady={handleTerminalReady}
          sendMessage={handleSendMessage}
        />
        {!isConnected && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-zinc-500 text-sm z-10">
            Connecting...
          </div>
        )}
        {isConnected && !currentSessionId && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-zinc-500 text-sm z-10">
            <div className="flex flex-col items-center gap-4">
              <p>No active sessions</p>
              <button
                className="px-5 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-zinc-300 text-[13px] cursor-pointer transition-all duration-150 hover:bg-zinc-700 hover:text-white hover:border-zinc-600"
                onClick={handleNewTab}
              >
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
