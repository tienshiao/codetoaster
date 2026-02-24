import { useCallback, useState, useMemo, useEffect, useRef, type ReactNode } from "react";
import { useNavigate, useMatches } from "@tanstack/react-router";
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
import { TerminalSearchBar } from "./components/TerminalSearchBar";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import "./index.css";

export function SessionLayout({ showNotFound = false, children }: { showNotFound?: boolean; children?: ReactNode }) {
  const {
    sessions,
    folders,
    currentSessionId,
    isConnected,
    sessionActivity,
    terminalRef,
    createSession,
    closeSession,
    renameSession,
    reorderSessions,
    createFolder,
    renameFolder,
    deleteFolder,
    handleTerminalReady,
    handleSizeChange,
    handleSendMessage,
  } = useSession();
  const currentSession = sessions.find((s) => s.id === currentSessionId);
  const isActive = currentSessionId ? (sessionActivity[currentSessionId] ?? false) : false;
  const navigate = useNavigate();
  const matches = useMatches();

  // Detect if we're on the diff route
  const isDiff = matches.some((m) => m.routeId === "/sessions/$slug/diff");

  const [searchOpen, setSearchOpen] = useState(false);

  const searchAddon = useMemo(
    () => searchOpen ? terminalRef.current?.getSearchAddon() ?? null : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchOpen],
  );

  const handleSearchClose = useCallback(() => {
    setSearchOpen(false);
    terminalRef.current?.focus();
  }, [terminalRef]);

  const wasDisconnected = useRef(false);
  useEffect(() => {
    if (!isConnected) {
      wasDisconnected.current = true;
      toast("Reconnecting...", { id: "reconnect", duration: Infinity });
    } else if (wasDisconnected.current) {
      wasDisconnected.current = false;
      toast.dismiss("reconnect");
    }
  }, [isConnected]);

  const [closeConfirmSessionId, setCloseConfirmSessionId] = useState<string | null>(null);
  const closeConfirmSession = closeConfirmSessionId
    ? sessions.find((s) => s.id === closeConfirmSessionId)
    : null;

  const handleNewTab = useCallback((folderId?: string) => {
    const { id, name } = createSession(folderId);
    navigate({
      to: "/sessions/$slug",
      params: { slug: buildSessionSlug({ id, name }) },
    });
  }, [createSession, navigate]);

  const handleNewFolder = useCallback(() => {
    createFolder();
  }, [createFolder]);

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

  const handleTabChange = useCallback(
    (tab: "terminal" | "diff") => {
      if (!currentSession) return;
      const slug = buildSessionSlug(currentSession);
      if (tab === "diff") {
        navigate({ to: "/sessions/$slug/diff", params: { slug } });
      } else {
        navigate({ to: "/sessions/$slug", params: { slug } });
        setTimeout(() => terminalRef.current?.focus(), 100);
      }
    },
    [currentSession, navigate, terminalRef],
  );

  return (
    <SidebarProvider className="h-svh">
      <AppSidebar
        sessions={sessions}
        folders={folders}
        currentSessionId={currentSessionId}
        isConnected={isConnected}
        sessionActivity={sessionActivity}
        onNewTab={handleNewTab}
        onCloseTab={handleCloseTab}
        onRenameSession={handleRenameSession}
        onReorder={reorderSessions}
        onAcknowledge={(id) => handleSendMessage({ type: "acknowledge", sessionId: id })}
        onNewFolder={handleNewFolder}
        onRenameFolder={renameFolder}
        onDeleteFolder={deleteFolder}
        onFocusTerminal={() => terminalRef.current?.focus()}
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
          onUpload={handleFileDrop}
          onFocusTerminal={() => terminalRef.current?.focus()}
          activeTab={isDiff ? "diff" : "terminal"}
          onTabChange={handleTabChange}
        />
        <div className="flex-1 relative overflow-hidden">
          {/* Terminal stays mounted, hidden when diff is active */}
          <div className={isDiff ? 'hidden' : 'relative h-full'}>
            <XTerminal
              ref={terminalRef}
              onSizeChange={handleSizeChange}
              onReady={handleTerminalReady}
              sendMessage={handleSendMessage}
              onFileDrop={handleFileDrop}
              onSearchOpen={() => setSearchOpen(true)}
            />
            {searchOpen && !isDiff && searchAddon && (
              <TerminalSearchBar
                searchAddon={searchAddon}
                onClose={handleSearchClose}
              />
            )}
          </div>

          {/* Diff view rendered via child route */}
          {isDiff && (
            <div className="h-full overflow-hidden">
              {children}
            </div>
          )}

          {isConnected && showNotFound && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-zinc-500 text-sm z-10">
              <div className="flex flex-col items-center gap-4">
                <p>Session not found</p>
                <Button variant="outline" onClick={() => handleNewTab()}>
                  <Plus /> New Session
                </Button>
              </div>
            </div>
          )}
          {isConnected && !showNotFound && !currentSessionId && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-zinc-500 text-sm z-10">
              <div className="flex flex-col items-center gap-4">
                <p>No active sessions</p>
                <Button variant="outline" onClick={() => handleNewTab()}>
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
              "{closeConfirmSession?.name ?? "Session"}{closeConfirmSession?.title ? ` — ${closeConfirmSession.title}` : ""}" is still running. Closing it will terminate the process.
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
