import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import type { TerminalHandle, TerminalSize } from "./Terminal";
import { useWebSocket } from "./hooks/use-websocket";

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

export interface FolderInfo {
  id: string;
  name: string;
  sessionIds: string[];
}

interface SessionContextValue {
  sessions: SessionInfo[];
  folders: FolderInfo[];
  currentSessionId: string | null;
  isConnected: boolean;
  sessionsLoaded: boolean;
  sessionActivity: Record<string, boolean>;
  terminalRef: React.RefObject<TerminalHandle | null>;
  attachSession: (id: string) => void;
  createSession: (folderId?: string) => { id: string; name: string };
  closeSession: (id: string) => void;
  renameSession: (id: string, name: string) => void;
  reorderSessions: (folders: Array<{ id: string; sessionIds: string[] }>) => void;
  createFolder: () => { id: string; name: string };
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;
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
  return crypto.randomUUID();
}

function generateSessionName(existingSessions: SessionInfo[]): string {
  let max = 0;
  for (const s of existingSessions) {
    const match = s.name.match(/^session-(\d+)$/);
    if (match) {
      max = Math.max(max, parseInt(match[1]!, 10));
    }
  }
  return `session-${max + 1}`;
}

function generateFolderName(existingFolders: FolderInfo[]): string {
  let max = 0;
  for (const f of existingFolders) {
    const match = f.name.match(/^folder-(\d+)$/);
    if (match) {
      max = Math.max(max, parseInt(match[1]!, 10));
    }
  }
  return `folder-${max + 1}`;
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
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [sessionActivity, setSessionActivity] = useState<Record<string, boolean>>({});
  const terminalRef = useRef<TerminalHandle | null>(null);
  const terminalReadyRef = useRef(false);
  const currentSessionIdRef = useRef<string | null>(null);
  const sessionsRef = useRef<SessionInfo[]>([]);
  const foldersRef = useRef<FolderInfo[]>([]);
  const messageQueueRef = useRef<any[]>([]);
  const sendRef = useRef<(msg: object) => void>(() => {});

  // Keep refs in sync with state
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    foldersRef.current = folders;
  }, [folders]);

  const onMessage = useCallback((message: any) => {
    if (message.type === "sessions") {
      const list = message.list as SessionInfo[];
      setSessions(list);
      if (message.folders) {
        setFolders(message.folders as FolderInfo[]);
      }
      setSessionsLoaded(true);
      return;
    }

    if (message.type === "attached") {
      setCurrentSessionId(message.sessionId);
    }

    if (message.type === "activity") {
      setSessionActivity(prev => ({ ...prev, [message.sessionId]: message.active }));
      return;
    }

    if (message.type === "notification") {
      // Auto-acknowledge if we're already viewing this session AND window has focus
      if (message.sessionId === currentSessionIdRef.current && document.hasFocus()) {
        sendRef.current({ type: "acknowledge", sessionId: message.sessionId });
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

  // When the window regains focus, ack any pending notification for the current session
  useEffect(() => {
    const handleFocus = () => {
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

  const attachSession = useCallback(
    (id: string) => {
      if (id === currentSessionIdRef.current) {
        send({ type: "acknowledge", sessionId: id });
        return;
      }

      terminalRef.current?.resetAttached();

      if (currentSessionIdRef.current) {
        send({ type: "detach" });
      }

      const size = terminalRef.current?.getSize() || { cols: 80, rows: 24 };
      send({ type: "attach", sessionId: id, cols: size.cols, rows: size.rows });
      send({ type: "acknowledge", sessionId: id });
      setCurrentSessionId(id);
    },
    [send],
  );

  const createSession = useCallback((folderId?: string): { id: string; name: string } => {
    terminalRef.current?.resetAttached();

    // Only inherit position/cwd when no explicit folder is targeted (e.g. Cmd+T)
    const afterSessionId = folderId ? undefined : (currentSessionIdRef.current || undefined);

    if (currentSessionIdRef.current) {
      send({ type: "detach" });
    }

    const sessionId = generateSessionId();
    const name = generateSessionName(sessionsRef.current);
    const size = terminalRef.current?.getSize() || { cols: 80, rows: 24 };

    // Derive folder from current session if not explicitly provided
    let resolvedFolderId = folderId;
    if (!resolvedFolderId && afterSessionId) {
      const currentFolder = foldersRef.current.find((f) => f.sessionIds.includes(afterSessionId));
      if (currentFolder) resolvedFolderId = currentFolder.id;
    }

    send({ type: "create", sessionId, name, cols: size.cols, rows: size.rows, folderId: resolvedFolderId, afterSessionId });
    setCurrentSessionId(sessionId);
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
    // Optimistically add to folder at correct position
    const targetFolderId = resolvedFolderId || "general";
    setFolders((prev) =>
      prev.map((f) => {
        if (f.id !== targetFolderId) return f;
        const newSessionIds = [...f.sessionIds];
        if (afterSessionId && (!folderId || folderId === f.id)) {
          const afterIndex = newSessionIds.indexOf(afterSessionId);
          if (afterIndex >= 0) {
            newSessionIds.splice(afterIndex + 1, 0, sessionId);
            return { ...f, sessionIds: newSessionIds };
          }
        }
        newSessionIds.push(sessionId);
        return { ...f, sessionIds: newSessionIds };
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
    (orderedFolders: Array<{ id: string; sessionIds: string[] }>) => {
      // Optimistically update folders
      setFolders((prev) => {
        const folderMap = new Map(prev.map((f) => [f.id, f]));
        const result: FolderInfo[] = [];
        const seen = new Set<string>();
        for (const { id, sessionIds } of orderedFolders) {
          const existing = folderMap.get(id);
          if (existing && !seen.has(id)) {
            result.push({ ...existing, sessionIds });
            seen.add(id);
          }
        }
        // Append missing folders
        for (const f of prev) {
          if (!seen.has(f.id)) result.push(f);
        }
        return result;
      });
      // Optimistically reorder sessions to match folder order
      setSessions((prev) => {
        const map = new Map(prev.map((s) => [s.id, s]));
        const reordered: SessionInfo[] = [];
        const seen = new Set<string>();
        for (const { sessionIds } of orderedFolders) {
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
      send({ type: "reorder", folders: orderedFolders });
    },
    [send],
  );

  const createFolder = useCallback((): { id: string; name: string } => {
    const id = crypto.randomUUID();
    const name = generateFolderName(foldersRef.current);
    setFolders((prev) => [...prev, { id, name, sessionIds: [] }]);
    send({ type: "createFolder", id, name });
    return { id, name };
  }, [send]);

  const renameFolder = useCallback(
    (id: string, name: string) => {
      setFolders((prev) =>
        prev.map((f) => (f.id === id ? { ...f, name } : f))
      );
      send({ type: "renameFolder", id, name });
    },
    [send],
  );

  const deleteFolder = useCallback(
    (id: string) => {
      setFolders((prev) => {
        const folder = prev.find((f) => f.id === id);
        if (!folder || id === "general") return prev;
        return prev
          .filter((f) => f.id !== id)
          .map((f) =>
            f.id === "general"
              ? { ...f, sessionIds: [...f.sessionIds, ...folder.sessionIds] }
              : f
          );
      });
      send({ type: "deleteFolder", id });
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
        folders,
        currentSessionId,
        isConnected,
        sessionsLoaded,
        sessionActivity,
        terminalRef,
        attachSession,
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
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}
