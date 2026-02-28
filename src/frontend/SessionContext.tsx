import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { useMatches } from "@tanstack/react-router";
import type { TerminalHandle, TerminalSize } from "./Terminal";
import { generateUUID } from "./utils/uuid";
import { generateSessionName } from "./utils/nameGenerator";
import { useWebSocket } from "./hooks/use-websocket";
import { playNotificationSound } from "./hooks/use-notification-sound";

export interface SessionInfo {
  id: string;
  name: string;
  title?: string;
  createdAt: number;
  size: { cols: number; rows: number };
  clientCount: number;
  exited?: boolean;
  hasNotification?: boolean;
}

export interface ProjectInfo {
  id: string;
  name: string;
  initialPath: string;
  color: string;
  sessionIds: string[];
}

interface SessionContextValue {
  sessions: SessionInfo[];
  projects: ProjectInfo[];
  currentSessionId: string | null;
  mruSessionIds: string[];
  isConnected: boolean;
  sessionsLoaded: boolean;
  sessionActivity: Record<string, boolean>;
  lastActivityAt: React.RefObject<Record<string, number>>;
  terminalRef: React.RefObject<TerminalHandle | null>;
  attachSession: (id: string) => void;
  createSession: (projectId?: string) => { id: string; name: string };
  closeSession: (id: string) => void;
  renameSession: (id: string, name: string) => void;
  reorderSessions: (projects: Array<{ id: string; sessionIds: string[] }>) => void;
  createProject: (name: string, initialPath: string, color: string) => { id: string };
  updateProject: (id: string, name: string, initialPath: string, color: string) => void;
  deleteProject: (id: string) => void;
  handleTerminalReady: () => void;
  handleSizeChange: (size: TerminalSize) => void;
  handleSendMessage: (msg: object) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}

function generateSessionId(): string {
  return generateUUID();
}

function fireWebNotification(
  title: string,
  body: string,
  tag: string,
  sessionName?: string,
  sessionTitle?: string,
) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    // Build a metadata line like "session-1 — vim"
    const metaParts = [sessionName, sessionTitle].filter(Boolean);
    const metaLine = metaParts.length > 0 ? metaParts.join(" — ") : undefined;
    const fullBody = [metaLine, body].filter(Boolean).join("\n") || undefined;

    const n = new Notification(title || "Terminal notification", {
      body: fullBody,
      tag,
    });
    setTimeout(() => n.close(), 5000);
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission();
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [mruSessionIds, setMruSessionIds] = useState<string[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [sessionActivity, setSessionActivity] = useState<Record<string, boolean>>({});
  const lastActivityAt = useRef<Record<string, number>>({});
  const terminalRef = useRef<TerminalHandle | null>(null);
  const terminalReadyRef = useRef(false);
  const currentSessionIdRef = useRef<string | null>(null);
  const sessionsRef = useRef<SessionInfo[]>([]);
  const projectsRef = useRef<ProjectInfo[]>([]);
  const messageQueueRef = useRef<any[]>([]);
  const sendRef = useRef<(msg: object) => void>(() => {});

  // Derive whether the user is viewing the terminal (not the diff tab)
  const matches = useMatches();
  const isDiff = matches.some(m => m.routeId === "/sessions/$slug/diff");
  const isViewingTerminalRef = useRef(!isDiff);
  useEffect(() => {
    isViewingTerminalRef.current = !isDiff;
  }, [isDiff]);

  // Keep refs in sync with state
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  const onMessage = useCallback((message: any) => {
    if (message.type === "sessions") {
      const list = message.list as SessionInfo[];
      setSessions(list);
      if (message.projects) {
        setProjects(message.projects as ProjectInfo[]);
      }
      setSessionsLoaded(true);
      return;
    }

    if (message.type === "attached") {
      setCurrentSessionId(message.sessionId);
    }

    if (message.type === "activity") {
      setSessionActivity(prev => ({ ...prev, [message.sessionId]: message.active }));
      if (message.active) {
        lastActivityAt.current[message.sessionId] = Date.now();
      }
      return;
    }

    if (message.type === "notification") {
      const isViewingThisSession =
        message.sessionId === currentSessionIdRef.current
        && document.hasFocus()
        && isViewingTerminalRef.current;

      if (isViewingThisSession) {
        sendRef.current({ type: "acknowledge", sessionId: message.sessionId });
      } else {
        playNotificationSound();
      }
      if (!document.hasFocus()) {
        const session = sessionsRef.current.find((s) => s.id === message.sessionId);
        fireWebNotification(
          message.title,
          message.body,
          `codetoaster-${message.sessionId}`,
          session?.name,
          session?.title,
        );
      }
      return;
    }

    // Forward terminal-related messages to terminal
    if (terminalRef.current) {
      terminalRef.current.handleMessage(message);
    } else {
      messageQueueRef.current.push(message);
    }
  }, []);

  const { send, isConnected } = useWebSocket({
    onMessage,
    onConnect: () => {
      if (terminalReadyRef.current) {
        send({ type: "list" });

        // Re-attach to the session that was active before disconnect
        const sessionId = currentSessionIdRef.current;
        if (sessionId) {
          const size = terminalRef.current?.getSize() || { cols: 80, rows: 24 };
          send({ type: "attach", sessionId, cols: size.cols, rows: size.rows });
        }
      }
    },
    onDisconnect: () => {
      setSessionsLoaded(false);
    },
  });
  sendRef.current = send;

  const handleTerminalReady = useCallback(() => {
    terminalReadyRef.current = true;

    if (terminalRef.current && messageQueueRef.current.length > 0) {
      for (const msg of messageQueueRef.current) {
        terminalRef.current.handleMessage(msg);
      }
      messageQueueRef.current = [];
    }

    send({ type: "list" });
  }, [send]);

  const handleSizeChange = useCallback(
    (size: TerminalSize) => {
      if (currentSessionIdRef.current) {
        send({ type: "resize", cols: size.cols, rows: size.rows });
      }
    },
    [send],
  );

  const handleSendMessage = useCallback(
    (msg: object) => {
      send(msg);
    },
    [send],
  );

  // Clean up stale MRU entries when sessions change
  useEffect(() => {
    const ids = new Set(sessions.map((s) => s.id));
    setMruSessionIds((prev) => {
      const filtered = prev.filter((id) => ids.has(id));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [sessions]);

  // When the window regains focus, ack any pending notification for the current session
  useEffect(() => {
    const handleFocus = () => {
      if (!isViewingTerminalRef.current) return;
      const sessionId = currentSessionIdRef.current;
      if (!sessionId) return;
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      if (session?.hasNotification) {
        sendRef.current({ type: "acknowledge", sessionId });
      }
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, []);

  // Acknowledge pending notifications when switching from diff → terminal
  useEffect(() => {
    if (!isDiff) {
      const sessionId = currentSessionIdRef.current;
      if (sessionId) {
        const session = sessionsRef.current.find(s => s.id === sessionId);
        if (session?.hasNotification) {
          sendRef.current({ type: "acknowledge", sessionId });
        }
      }
    }
  }, [isDiff]);

  const pushMru = useCallback((id: string) => {
    setMruSessionIds((prev) => [id, ...prev.filter((x) => x !== id)]);
  }, []);

  const attachSession = useCallback(
    (id: string) => {
      if (id === currentSessionIdRef.current) {
        if (isViewingTerminalRef.current) {
          send({ type: "acknowledge", sessionId: id });
        }
        return;
      }

      terminalRef.current?.resetAttached();

      if (currentSessionIdRef.current) {
        send({ type: "detach" });
      }

      const size = terminalRef.current?.getSize() || { cols: 80, rows: 24 };
      send({ type: "attach", sessionId: id, cols: size.cols, rows: size.rows });
      if (isViewingTerminalRef.current) {
        send({ type: "acknowledge", sessionId: id });
      }
      setCurrentSessionId(id);
      pushMru(id);
    },
    [send, pushMru],
  );

  const createSession = useCallback((projectId?: string): { id: string; name: string } => {
    terminalRef.current?.resetAttached();

    // Only inherit position/cwd when no explicit project is targeted (e.g. Cmd+T)
    const afterSessionId = projectId ? undefined : (currentSessionIdRef.current || undefined);

    if (currentSessionIdRef.current) {
      send({ type: "detach" });
    }

    const sessionId = generateSessionId();
    const name = generateSessionName(sessionsRef.current.map(s => s.name));
    const size = terminalRef.current?.getSize() || { cols: 80, rows: 24 };

    // Derive project from current session if not explicitly provided
    let resolvedProjectId = projectId;
    if (!resolvedProjectId && afterSessionId) {
      const currentProject = projectsRef.current.find((p) => p.sessionIds.includes(afterSessionId));
      if (currentProject) resolvedProjectId = currentProject.id;
    }

    send({ type: "create", sessionId, name, cols: size.cols, rows: size.rows, projectId: resolvedProjectId, afterSessionId });
    setCurrentSessionId(sessionId);
    pushMru(sessionId);
    setSessions((prev) => [
      ...prev,
      {
        id: sessionId,
        name,
        createdAt: Date.now(),
        size: { cols: size.cols, rows: size.rows },
        clientCount: 1,
      },
    ]);
    // Optimistically add to project at correct position
    const targetProjectId = resolvedProjectId || "general";
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== targetProjectId) return p;
        const newSessionIds = [...p.sessionIds];
        if (afterSessionId && (!projectId || projectId === p.id)) {
          const afterIndex = newSessionIds.indexOf(afterSessionId);
          if (afterIndex >= 0) {
            newSessionIds.splice(afterIndex + 1, 0, sessionId);
            return { ...p, sessionIds: newSessionIds };
          }
        }
        newSessionIds.push(sessionId);
        return { ...p, sessionIds: newSessionIds };
      })
    );
    return { id: sessionId, name };
  }, [send]);

  const renameSession = useCallback(
    (id: string, name: string) => {
      send({ type: "rename", sessionId: id, name });
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, name } : s))
      );
    },
    [send],
  );

  const reorderSessions = useCallback(
    (orderedProjects: Array<{ id: string; sessionIds: string[] }>) => {
      // Optimistically update projects
      setProjects((prev) => {
        const projectMap = new Map(prev.map((p) => [p.id, p]));
        const result: ProjectInfo[] = [];
        const seen = new Set<string>();
        for (const { id, sessionIds } of orderedProjects) {
          const existing = projectMap.get(id);
          if (existing && !seen.has(id)) {
            result.push({ ...existing, sessionIds });
            seen.add(id);
          }
        }
        // Append missing projects
        for (const p of prev) {
          if (!seen.has(p.id)) result.push(p);
        }
        return result;
      });
      // Optimistically reorder sessions to match project order
      setSessions((prev) => {
        const map = new Map(prev.map((s) => [s.id, s]));
        const reordered: SessionInfo[] = [];
        const seen = new Set<string>();
        for (const { sessionIds } of orderedProjects) {
          for (const id of sessionIds) {
            const s = map.get(id);
            if (s && !seen.has(id)) {
              reordered.push(s);
              seen.add(id);
            }
          }
        }
        for (const s of prev) {
          if (!seen.has(s.id)) reordered.push(s);
        }
        return reordered;
      });
      send({ type: "reorder", projects: orderedProjects });
    },
    [send],
  );

  const createProject = useCallback((name: string, initialPath: string, color: string): { id: string } => {
    const id = generateUUID();
    setProjects((prev) => [...prev, { id, name, initialPath, color, sessionIds: [] }]);
    send({ type: "createProject", id, name, initialPath, color });
    return { id };
  }, [send]);

  const updateProject = useCallback(
    (id: string, name: string, initialPath: string, color: string) => {
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, name, initialPath, color } : p))
      );
      send({ type: "updateProject", id, name, initialPath, color });
    },
    [send],
  );

  const deleteProject = useCallback(
    (id: string) => {
      setProjects((prev) => {
        const project = prev.find((p) => p.id === id);
        if (!project || id === "general") return prev;
        return prev
          .filter((p) => p.id !== id)
          .map((p) =>
            p.id === "general"
              ? { ...p, sessionIds: [...p.sessionIds, ...project.sessionIds] }
              : p
          );
      });
      send({ type: "deleteProject", id });
    },
    [send],
  );

  const closeSession = useCallback(
    (id: string) => {
      send({ type: "kill", sessionId: id });

      if (id === currentSessionIdRef.current) {
        terminalRef.current?.resetAttached();
        setCurrentSessionId(null);
      }

      setSessions((prev) => prev.filter((s) => s.id !== id));
    },
    [send],
  );

  return (
    <SessionContext.Provider
      value={{
        sessions,
        projects,
        currentSessionId,
        mruSessionIds,
        isConnected,
        sessionsLoaded,
        sessionActivity,
        lastActivityAt,
        terminalRef,
        attachSession,
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
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}
