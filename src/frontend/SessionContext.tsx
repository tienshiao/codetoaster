import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import type { SessionInfo } from "./AppSidebar";
import type { TerminalHandle, TerminalSize } from "./Terminal";

interface SessionContextValue {
  sessions: SessionInfo[];
  currentSessionId: string | null;
  isConnected: boolean;
  sessionActivity: Record<string, boolean>;
  terminalRef: React.RefObject<TerminalHandle | null>;
  attachSession: (id: string) => void;
  createSession: () => { id: string; name: string };
  closeSession: (id: string) => void;
  renameSession: (id: string, name: string) => void;
  reorderSessions: (sessionIds: string[]) => void;
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

function fireWebNotification(title: string, body: string, tag: string) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    const n = new Notification(title || "Terminal notification", {
      body: body || undefined,
      tag,
    });
    setTimeout(() => n.close(), 5000);
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission();
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [sessionActivity, setSessionActivity] = useState<Record<string, boolean>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<TerminalHandle | null>(null);
  const terminalReadyRef = useRef(false);
  const currentSessionIdRef = useRef<string | null>(null);
  const sessionsRef = useRef<SessionInfo[]>([]);
  const messageQueueRef = useRef<any[]>([]);

  // Keep refs in sync with state
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const send = useCallback((msg: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const requestSessionList = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && terminalReadyRef.current) {
      ws.send(JSON.stringify({ type: "list" }));
    }
  }, []);

  // Connect WebSocket
  useEffect(() => {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${location.host}/terminal`);
    wsRef.current = socket;

    socket.onopen = () => {
      if (wsRef.current !== socket) return;
      setIsConnected(true);
      requestSessionList();
    };

    socket.onmessage = (e) => {
      if (wsRef.current !== socket) return;

      let message;
      try {
        message = JSON.parse(e.data);
      } catch {
        return;
      }

      if (message.type === "sessions") {
        const list = message.list as SessionInfo[];
        setSessions(list);
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
        if (!document.hasFocus()) {
          fireWebNotification(message.title, message.body, `codetoaster-${message.sessionId}`);
        }
        return;
      }

      // Forward terminal-related messages to terminal
      if (terminalRef.current) {
        terminalRef.current.handleMessage(message);
      } else {
        messageQueueRef.current.push(message);
      }
    };

    socket.onclose = () => {
      if (wsRef.current === socket) {
        setIsConnected(false);
        wsRef.current = null;
      }
    };

    return () => {
      socket.close();
    };
  }, [requestSessionList]);

  const handleTerminalReady = useCallback(() => {
    terminalReadyRef.current = true;

    if (terminalRef.current && messageQueueRef.current.length > 0) {
      for (const msg of messageQueueRef.current) {
        terminalRef.current.handleMessage(msg);
      }
      messageQueueRef.current = [];
    }

    requestSessionList();
  }, [requestSessionList]);

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

  const createSession = useCallback((): { id: string; name: string } => {
    terminalRef.current?.resetAttached();

    if (currentSessionIdRef.current) {
      send({ type: "detach" });
    }

    const sessionId = generateSessionId();
    const name = generateSessionName(sessionsRef.current);
    const size = terminalRef.current?.getSize() || { cols: 80, rows: 24 };
    send({ type: "create", sessionId, name, cols: size.cols, rows: size.rows });
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
    (sessionIds: string[]) => {
      setSessions((prev) => {
        const map = new Map(prev.map((s) => [s.id, s]));
        const reordered: SessionInfo[] = [];
        for (const id of sessionIds) {
          const s = map.get(id);
          if (s) reordered.push(s);
        }
        // Append any sessions not in sessionIds
        for (const s of prev) {
          if (!sessionIds.includes(s.id)) reordered.push(s);
        }
        return reordered;
      });
      send({ type: "reorder", sessionIds });
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
        currentSessionId,
        isConnected,
        sessionActivity,
        terminalRef,
        attachSession,
        createSession,
        closeSession,
        renameSession,
        reorderSessions,
        handleTerminalReady,
        handleSizeChange,
        handleSendMessage,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}
