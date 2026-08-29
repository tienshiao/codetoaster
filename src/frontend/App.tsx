import { useCallback, useState, useMemo, useEffect, useRef, type ReactNode } from "react";
import { useNavigate, useMatches } from "@tanstack/react-router";
import { AppSidebar } from "./AppSidebar";
import { TopBar } from "./TopBar";
import { XTerminal } from "./Terminal";
import { useSession } from "./SessionContext";
import { useUploadFiles } from "./hooks/use-upload-mutation";
import { buildSessionSlug, parseSessionSlug } from "./utils/slug";
import { tabNavTarget, closeNavTarget, TAB_ROUTES } from "./utils/session-nav";
import { setLastTab } from "./view-state-store";
import type { TabType } from "./types/tab";
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
    sessionLabels,
    projects,
    currentSessionId,
    currentPtyId,
    isConnected,
    sessionActivity,
    resumingSessionIds,
    restoringSessionId,
    resumeFailedSessionIds,
    retryResume,
    lastActivityAt,
    terminalRef,
    createSession,
    closeSession,
    renameSession,
    reorderSessions,
    createProject,
    updateProject,
    deleteProject,
    handleTerminalReady,
    handleSizeChange,
    handleSendMessage,
    handleRestoreEnd,
  } = useSession();
  const currentSession = sessions.find((s) => s.id === currentSessionId);
  const uploadMutation = useUploadFiles(currentSessionId ?? undefined);

  const isActive = currentSessionId ? (sessionActivity[currentSessionId] ?? false) : false;
  const navigate = useNavigate();
  const matches = useMatches();

  // Detect current tab
  const currentTab: TabType = matches.some((m) => m.routeId === "/sessions/$slug/diff")
    ? "diff"
    : matches.some((m) => m.routeId === "/sessions/$slug/file")
    ? "file"
    : matches.some((m) => m.routeId === "/sessions/$slug/git")
    ? "git"
    : "terminal";

  // Record the last-viewed tab per session so session switches can restore it.
  // Keyed by the slug's session id (not currentSessionId): the slug and tab
  // change atomically with the route, while currentSessionId lags one effect
  // behind and would briefly attribute the new route's tab to the old session.
  const slugMatch = matches.find((m) => m.routeId === "/sessions/$slug");
  const routeSessionId = slugMatch
    ? parseSessionSlug((slugMatch.params as { slug: string }).slug).id
    : null;
  useEffect(() => {
    if (routeSessionId) setLastTab(routeSessionId, currentTab);
  }, [routeSessionId, currentTab]);

  // The slug carries the session name, but the name is not known at creation:
  // the client sends none and the server derives "<dir> · <branch>" from the
  // resolved cwd. Re-project the slug whenever it falls behind — after that
  // derived name arrives, or after a rename — so the readable half of the URL
  // catches up instead of staying pinned to the placeholder the session was
  // created under. (The live terminal title never moves the slug: it is a
  // render-time label, not the stored name.)
  //
  // Search params pass through untouched: for the file and git tabs the URL is
  // the source of truth for the selection, so rebuilding the target from the
  // view-state store could resurrect a stale file or drop ?line=. The route is
  // named explicitly rather than relatively for the same reason — a relative
  // navigation resolves against /sessions/$slug and would drop the tab
  // segment. Always replaces: a name landing is not a navigation, and the id
  // that lookups key off is unchanged, so this never re-attaches.
  const routeSlug = slugMatch ? (slugMatch.params as { slug: string }).slug : null;
  const routeSession = sessions.find((s) => s.id === routeSessionId);
  const canonicalSlug = routeSession ? buildSessionSlug(routeSession) : null;
  useEffect(() => {
    if (!routeSlug || !canonicalSlug || routeSlug === canonicalSlug) return;
    navigate({
      to: TAB_ROUTES[currentTab],
      params: { slug: canonicalSlug },
      search: (prev: Record<string, unknown>) => prev,
      replace: true,
    });
  }, [routeSlug, canonicalSlug, currentTab, navigate]);

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

  const handleNewTab = useCallback(async (projectId?: string) => {
    // Nothing to navigate to if the server refused — createSession has already
    // said why.
    const created = await createSession(projectId);
    if (!created) return;
    navigate({
      to: "/sessions/$slug",
      params: { slug: buildSessionSlug(created) },
    });
    setTimeout(() => terminalRef.current?.focus(), 100);
  }, [createSession, navigate, terminalRef]);

  const performClose = useCallback(
    (id: string) => {
      const remaining = sessions.filter((s) => s.id !== id);
      closeSession(id);

      if (id === currentSessionId) {
        navigate(closeNavTarget(remaining));
      }
    },
    [sessions, currentSessionId, closeSession, navigate],
  );

  const handleRenameSession = useCallback(
    (id: string, newName: string) => {
      // No navigation here: the new name lands in `sessions`, which moves
      // canonicalSlug, and the re-projection effect above rewrites the slug in
      // place. Navigating via sessionNavTarget instead would rebuild the search
      // params from the view-state store and can resurrect a stale file.
      renameSession(id, newName);
    },
    [renameSession],
  );

  const handleFileDrop = useCallback(
    (files: File[]) => {
      uploadMutation.mutate(files);
    },
    [uploadMutation],
  );

  const handleCloseTab = useCallback(
    (id: string) => {
      const session = sessions.find((s) => s.id === id);
      // Suspended counts as nothing to warn about, the same as exited: the
      // dialog's whole claim is "this is still running, closing it will end
      // the process", and a suspended task has had its processes taken already
      // (§6). Asking anyway put a warning about work in progress in front of a
      // task that has none.
      if (session?.exited || session?.lifecycle === "suspended") {
        performClose(id);
      } else {
        setCloseConfirmSessionId(id);
      }
    },
    [sessions, performClose],
  );

  const handleTabChange = useCallback(
    (tab: TabType) => {
      if (!currentSession) return;
      navigate(tabNavTarget(currentSession, tab));
      if (tab === "terminal") {
        setTimeout(() => terminalRef.current?.focus(), 100);
      }
    },
    [currentSession, navigate, terminalRef],
  );

  return (
    <>
      <AppSidebar
        sessions={sessions}
        sessionLabels={sessionLabels}
        projects={projects}
        currentSessionId={currentSessionId}
        isConnected={isConnected}
        sessionActivity={sessionActivity}
        resumingSessionIds={resumingSessionIds}
        lastActivityAt={lastActivityAt}
        onNewTab={handleNewTab}
        onCloseTab={handleCloseTab}
        onRenameSession={handleRenameSession}
        onReorder={reorderSessions}
        onAcknowledge={(id) => handleSendMessage({ type: "acknowledge", taskId: id })}
        onCreateProject={createProject}
        onUpdateProject={updateProject}
        onDeleteProject={deleteProject}
        onFocusTerminal={() => terminalRef.current?.focus()}
      />
      <div className="flex-1 h-full overflow-hidden flex flex-col">
        <TopBar
          isConnected={isConnected}
          isExited={!!currentSession?.exited}
          isActive={isActive}
          isSuspended={currentSession?.lifecycle === "suspended"}
          hasNotification={currentSession?.hasNotification ?? false}
          hasSession={!!currentSession}
          name={currentSession?.name}
          label={currentSessionId ? sessionLabels.get(currentSessionId) : undefined}
          onUpload={handleFileDrop}
          onFocusTerminal={() => terminalRef.current?.focus()}
          activeTab={currentTab}
          onTabChange={handleTabChange}
        />
        <div className="flex-1 relative overflow-hidden">
          {/* Terminal stays mounted, hidden when diff or file view is active */}
          <div className={currentTab !== "terminal" ? 'hidden' : 'relative h-full'}>
            <XTerminal
              ref={terminalRef}
              ptyId={currentPtyId}
              onSizeChange={handleSizeChange}
              onReady={handleTerminalReady}
              sendMessage={handleSendMessage}
              onFileDrop={handleFileDrop}
              onSearchOpen={() => setSearchOpen(true)}
              onRestoreEnd={handleRestoreEnd}
            />
            {/* The reopen's read-only phase, said out loud (§5.5). An overlay
                rather than a line written into the grid: the swap resets the
                terminal, which would wipe anything written there, and until it
                does the grid is holding the snapshot — a banner typed into it
                would corrupt the one thing the user came back to see. Sized to
                stay out of the way for the same reason, and click-through
                except for the button that is there to be clicked. */}
            {currentSessionId && resumeFailedSessionIds.has(currentSessionId) ? (
              <div className="absolute inset-x-0 top-3 z-20 flex justify-center pointer-events-none">
                <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-zinc-700 bg-zinc-900/95 py-1.5 pl-4 pr-1.5 text-sm text-zinc-300 shadow-lg">
                  <span>Could not resume this session</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 rounded-full"
                    onClick={() => retryResume(currentSessionId)}
                  >
                    Try again
                  </Button>
                </div>
              </div>
            ) : currentSessionId &&
              (restoringSessionId === currentSessionId || resumingSessionIds.has(currentSessionId)) ? (
              <div className="absolute inset-x-0 top-3 z-20 flex justify-center pointer-events-none">
                <div className="flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/95 px-4 py-1.5 text-sm text-zinc-300 shadow-lg">
                  <span className="size-2 rounded-full bg-amber-400 animate-pulse" />
                  <span>Suspended — resuming…</span>
                </div>
              </div>
            ) : currentSessionId && currentSession?.lifecycle === "suspended" ? (
              /* The task the user is looking at was suspended out from under
                 the view — they closed it themselves, another client did, or
                 the harvester took it. The row survives now (§6), so the slug
                 still resolves and the route's attach effect stays latched on
                 an attachment that died with the PTY; clicking the sidebar row
                 navigates to the slug it is already on and changes nothing.
                 This is the way back, and it calls the resume directly rather
                 than trying to make the router re-fire — unlatching there would
                 re-attach on the next delta and reopen a task the moment it was
                 closed. */
              <div className="absolute inset-x-0 top-3 z-20 flex justify-center pointer-events-none">
                <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-zinc-700 bg-zinc-900/95 py-1.5 pl-4 pr-1.5 text-sm text-zinc-300 shadow-lg">
                  <span className="size-2 rounded-full border border-zinc-500" />
                  <span>This session is suspended</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 rounded-full"
                    onClick={() => retryResume(currentSessionId)}
                  >
                    Reopen
                  </Button>
                </div>
              </div>
            ) : null}
            {searchOpen && currentTab === "terminal" && searchAddon && (
              <TerminalSearchBar
                searchAddon={searchAddon}
                onClose={handleSearchClose}
              />
            )}
          </div>

          {/* Diff and File views rendered via child route */}
          {currentTab !== "terminal" && (
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
              "{closeConfirmSessionId ? sessionLabels.get(closeConfirmSessionId) ?? closeConfirmSession?.name ?? "Session" : "Session"}" is still running. Closing it ends the process; the session stays in the sidebar and reopens where it left off.
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
    </>
  );
}

export default SessionLayout;
