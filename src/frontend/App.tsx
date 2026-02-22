import { useCallback, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AppSidebar } from "./AppSidebar";
import { TopBar } from "./TopBar";
import { SidebarProvider } from "./components/ui/sidebar";
import { XTerminal } from "./Terminal";
import { useSession } from "./SessionContext";
import { buildSessionSlug } from "./utils/slug";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./components/ui/alert-dialog";
import { Button } from "./components/ui/button";
import { Plus } from "lucide-react";
import "./index.css";

export function SessionLayout() {
  const {
    sessions,
    currentSessionId,
    isConnected,
    sessionActivity,
    terminalRef,
    createSession,
    closeSession,
    renameSession,
    handleTerminalReady,
    handleSizeChange,
    handleSendMessage,
  } = useSession();
  const currentSession = sessions.find((s) => s.id === currentSessionId);
  const isActive = currentSessionId ? (sessionActivity[currentSessionId] ?? false) : false;
  const navigate = useNavigate();

  const [closeConfirmSessionId, setCloseConfirmSessionId] = useState<string | null>(null);
  const closeConfirmSession = closeConfirmSessionId
    ? sessions.find((s) => s.id === closeConfirmSessionId)
    : null;

  const handleNewTab = useCallback(() => {
    const { id, name } = createSession();
    navigate({
      to: "/sessions/$slug",
      params: { slug: buildSessionSlug({ id, name }) },
    });
  }, [createSession, navigate]);

  const performClose = useCallback(
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

  const handleRenameSession = useCallback(
    (id: string, newName: string) => {
      renameSession(id, newName);
      if (id === currentSessionId) {
        navigate({
          to: "/sessions/$slug",
          params: { slug: buildSessionSlug({ id, name: newName }) },
          replace: true,
        });
      }
    },
    [currentSessionId, renameSession, navigate],
  );

  const handleFileDrop = useCallback(
    async (files: File[]) => {
      if (!currentSessionId) return;
      const formData = new FormData();
      for (const file of files) formData.append("files", file);
      await fetch(`/api/sessions/${currentSessionId}/upload`, {
        method: "POST",
        body: formData,
      });
    },
    [currentSessionId],
  );

  const handleCloseTab = useCallback(
    (id: string) => {
      const session = sessions.find((s) => s.id === id);
      if (session?.exited) {
        performClose(id);
      } else {
        setCloseConfirmSessionId(id);
      }
    },
    [sessions, performClose],
  );

  return (
    <SidebarProvider className="h-svh">
      <AppSidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        isConnected={isConnected}
        sessionActivity={sessionActivity}
        onNewTab={handleNewTab}
        onCloseTab={handleCloseTab}
        onRenameSession={handleRenameSession}
        onAcknowledge={(id) => handleSendMessage({ type: "acknowledge", sessionId: id })}
      />
      <div className="flex-1 h-full overflow-hidden flex flex-col">
        <TopBar
          isConnected={isConnected}
          isExited={!!currentSession?.exited}
          isActive={isActive}
          hasNotification={currentSession?.hasNotification ?? false}
          hasSession={!!currentSession}
          name={currentSession?.name}
          title={currentSession?.title}
        />
        <div className="flex-1 relative overflow-hidden">
          <XTerminal
            ref={terminalRef}
            onSizeChange={handleSizeChange}
            onReady={handleTerminalReady}
            sendMessage={handleSendMessage}
            onFileDrop={handleFileDrop}
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
                <Button variant="outline" onClick={handleNewTab}>
                  <Plus /> New Session
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <AlertDialog
        open={closeConfirmSessionId !== null}
        onOpenChange={(open) => { if (!open) setCloseConfirmSessionId(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close session?</AlertDialogTitle>
            <AlertDialogDescription>
              "{closeConfirmSession?.title ?? closeConfirmSession?.name ?? "Session"}" is still running. Closing it will terminate the process.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (closeConfirmSessionId) {
                  performClose(closeConfirmSessionId);
                }
                setCloseConfirmSessionId(null);
              }}
            >
              Close session
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  );
}

export default SessionLayout;
