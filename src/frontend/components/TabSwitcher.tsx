import { useState, useEffect, useCallback, useId, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSession } from "../SessionContext";
import { useTerminalPreview } from "../hooks/use-terminal-preview";
import { useTerminalTheme } from "../hooks/use-terminal-theme";
import { buildSessionSlug } from "../utils/slug";
import { StatusDot } from "./StatusDot";

export function TabSwitcher() {
  const {
    sessions,
    projects,
    mruSessionIds,
    currentSessionId,
    isConnected,
    sessionActivity,
    lastActivityAt,
    terminalRef,
    attachSession,
  } = useSession();
  const navigate = useNavigate();
  const { theme, cssFontFamily, themeName } = useTerminalTheme();
  const { fetchPreview, getPreview } = useTerminalPreview(
    sessions,
    theme,
    themeName,
    lastActivityAt,
  );

  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(1);
  const scopeId = useId();
  const scopeClass = `ts-${scopeId.replace(/:/g, "")}`;
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const suppressContextMenuRef = useRef(false);

  // Build MRU-ordered session list
  const mruSessions = (() => {
    const sessionMap = new Map(sessions.map((s) => [s.id, s]));
    const ordered: typeof sessions = [];
    const seen = new Set<string>();
    for (const id of mruSessionIds) {
      const s = sessionMap.get(id);
      if (s && !seen.has(id)) {
        ordered.push(s);
        seen.add(id);
      }
    }
    // Append sessions not in MRU list (e.g. sessions from other clients)
    for (const s of sessions) {
      if (!seen.has(s.id)) {
        ordered.push(s);
        seen.add(s.id);
      }
    }
    return ordered;
  })();

  const selectedSession = mruSessions[selectedIndex];

  // Fetch preview when selection changes
  useEffect(() => {
    if (isOpen && selectedSession) {
      fetchPreview(selectedSession.id);
    }
  }, [isOpen, selectedSession?.id, fetchPreview]);

  // Scroll selected item into view
  useEffect(() => {
    if (isOpen) {
      itemRefs.current.get(selectedIndex)?.scrollIntoView({ block: "nearest" });
    }
  }, [isOpen, selectedIndex]);

  const open = useCallback(() => {
    if (mruSessions.length < 2) return;
    setSelectedIndex(1);
    setIsOpen(true);
  }, [mruSessions.length]);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const commit = useCallback(() => {
    if (!selectedSession) {
      close();
      return;
    }
    attachSession(selectedSession.id);
    navigate({
      to: "/sessions/$slug",
      params: { slug: buildSessionSlug(selectedSession) },
    });
    close();
    // Re-focus terminal after switching
    setTimeout(() => terminalRef.current?.focus(), 0);
  }, [selectedSession, attachSession, navigate, close, terminalRef]);

  const cancel = useCallback(() => {
    close();
    // Re-focus terminal
    setTimeout(() => terminalRef.current?.focus(), 0);
  }, [close, terminalRef]);

  // Keyboard handling
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Ctrl+` (backtick = "`", but with shift it becomes "~")
      const isBacktick = e.key === "`" && (e.ctrlKey || e.metaKey) && !e.altKey;
      const isTilde = e.key === "~" && (e.ctrlKey || e.metaKey) && !e.altKey;

      if (isBacktick && !e.shiftKey) {
        e.preventDefault();
        if (!isOpen) {
          if (mruSessions.length < 2) return;
          setSelectedIndex(1);
          setIsOpen(true);
        } else {
          // Advance forward
          setSelectedIndex((prev) => (prev + 1) % mruSessions.length);
        }
        return;
      }

      if ((isBacktick && e.shiftKey) || isTilde) {
        e.preventDefault();
        if (isOpen) {
          // Cycle backward
          setSelectedIndex(
            (prev) => (prev - 1 + mruSessions.length) % mruSessions.length,
          );
        }
        return;
      }

      if (e.key === "Escape" && isOpen) {
        e.preventDefault();
        cancel();
        return;
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.key === "Control" && isOpen) {
        e.preventDefault();
        commit();
      }
      if (e.key === "Meta" && isOpen) {
        e.preventDefault();
        commit();
      }
    }

    function onContextMenu(e: MouseEvent) {
      if (isOpen || suppressContextMenuRef.current) {
        e.preventDefault();
        suppressContextMenuRef.current = false;
      }
    }

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("contextmenu", onContextMenu, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("contextmenu", onContextMenu, true);
    };
  }, [isOpen, mruSessions, commit, cancel]);

  if (!isOpen) return null;

  const getProjectForSession = (sessionId: string) =>
    projects.find((p) => p.sessionIds.includes(sessionId));

  const previewHtml = selectedSession ? getPreview(selectedSession.id) : null;
  const bg = theme?.background ?? "#1e1e1e";
  const fg = theme?.foreground ?? "#d4d4d4";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="flex gap-4 max-w-[800px] rounded-xl border border-border bg-popover shadow-2xl p-4" style={{ height: 312 }}>
        {/* Session list */}
        <div className="flex flex-col gap-1 min-w-[260px] overflow-y-auto">
          <div className="text-xs text-muted-foreground px-2 pb-1 font-medium">
            Switch Session
          </div>
          {mruSessions.map((session, index) => {
            const project = getProjectForSession(session.id);
            const isSelected = index === selectedIndex;
            return (
              <div
                key={session.id}
                ref={(el) => {
                  if (el) itemRefs.current.set(index, el);
                  else itemRefs.current.delete(index);
                }}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                  isSelected
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50"
                }`}
                onMouseEnter={() => setSelectedIndex(index)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  suppressContextMenuRef.current = true;
                  setSelectedIndex(index);
                  commit();
                }}
              >
                <StatusDot
                  isConnected={isConnected}
                  isExited={!!session.exited}
                  isActive={!!sessionActivity[session.id]}
                />
                <div className="flex flex-col min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">
                      {session.name}
                    </span>
                    {session.id === currentSessionId && (
                      <span className="text-[10px] text-muted-foreground">
                        current
                      </span>
                    )}
                  </div>
                  {session.title && (
                    <span className="text-xs text-muted-foreground truncate">
                      {session.title}
                    </span>
                  )}
                </div>
                {project && project.id !== "general" && (
                  <span
                    className="shrink-0 w-2 h-2 rounded-full"
                    style={{ backgroundColor: project.color }}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Terminal preview */}
        <div
          className="rounded-lg overflow-hidden border border-border shrink-0"
          style={{ width: 480, height: 280, backgroundColor: bg }}
        >
          {previewHtml ? (
            <div
              className={`${scopeClass} w-full h-full overflow-hidden pointer-events-none`}
            >
              <style
                dangerouslySetInnerHTML={{
                  __html: `
                .${scopeClass} pre {
                  margin: 0 !important;
                  padding: 4px !important;
                  background: transparent !important;
                }
                .${scopeClass} pre > div {
                  font-size: 9px !important;
                  line-height: 11px !important;
                  font-family: ${cssFontFamily} !important;
                }
                .${scopeClass} pre > div > div {
                  background: inherit !important;
                }
              `,
                }}
              />
              <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
            </div>
          ) : (
            <div
              className="flex items-center justify-center w-full h-full text-xs"
              style={{ color: fg }}
            >
              Loading...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
