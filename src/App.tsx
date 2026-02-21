import { useState, useEffect, useCallback, useRef } from "react";
import { Sidebar, SessionInfo } from "./Sidebar";
import { XTerminal, TerminalHandle, TerminalSize } from "./Terminal";
import "./index.css";

let sessionCounter = 0;

function generateSessionId(): string {
  return `session-${++sessionCounter}`;
}

export function App() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<TerminalHandle | null>(null);
  const terminalReadyRef = useRef(false);
  const currentSessionIdRef = useRef<string | null>(null);
  const messageQueueRef = useRef<any[]>([]);

  // Keep ref in sync with state
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  // Send helper
  const send = useCallback((msg: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  // Try to kick off session list request - called from both onopen and onReady
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
      // Guard against stale socket (React Strict Mode runs effects twice)
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

      // Handle session-related messages in App
      if (message.type === "sessions") {
        const list = message.list as SessionInfo[];
        setSessions(list);

        const currentId = currentSessionIdRef.current;
        if (list.length > 0 && !currentId) {
          const sessionId = list[0].id;
          setCurrentSessionId(sessionId);
          const size = terminalRef.current?.getSize() || { cols: 80, rows: 24 };
          socket.send(JSON.stringify({ type: "attach", sessionId, cols: size.cols, rows: size.rows }));
        } else if (list.length === 0 && !currentId) {
          const sessionId = generateSessionId();
          const size = terminalRef.current?.getSize() || { cols: 80, rows: 24 };
          socket.send(JSON.stringify({ type: "create", sessionId, cols: size.cols, rows: size.rows }));
          setSessions([{
            id: sessionId,
            createdAt: Date.now(),
            size: { cols: size.cols, rows: size.rows },
            clientCount: 1,
          }]);
          setCurrentSessionId(sessionId);
        }
        return;
      }

      if (message.type === "attached") {
        setCurrentSessionId(message.sessionId);
      }

      // Forward terminal-related messages to terminal
      if (terminalRef.current) {
        terminalRef.current.handleMessage(message);
      } else {
        messageQueueRef.current.push(message);
      }
    };

    socket.onclose = () => {
      // Only reset if this is still the active socket
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

    // Process any queued messages
    if (terminalRef.current && messageQueueRef.current.length > 0) {
      for (const msg of messageQueueRef.current) {
        terminalRef.current.handleMessage(msg);
      }
      messageQueueRef.current = [];
    }

    requestSessionList();
  }, [requestSessionList]);

  const handleSizeChange = useCallback((size: TerminalSize) => {
    if (currentSessionIdRef.current) {
      send({ type: "resize", cols: size.cols, rows: size.rows });
    }
  }, [send]);

  const handleSendMessage = useCallback((msg: object) => {
    send(msg);
  }, [send]);

  const handleSelectTab = useCallback((id: string) => {
    if (id === currentSessionIdRef.current) return;

    terminalRef.current?.resetAttached();

    if (currentSessionIdRef.current) {
      send({ type: "detach" });
    }

    const size = terminalRef.current?.getSize() || { cols: 80, rows: 24 };
    send({ type: "attach", sessionId: id, cols: size.cols, rows: size.rows });
    setCurrentSessionId(id);
  }, [send]);

  const handleNewTab = useCallback(() => {
    terminalRef.current?.resetAttached();

    if (currentSessionIdRef.current) {
      send({ type: "detach" });
    }

    const sessionId = generateSessionId();
    const size = terminalRef.current?.getSize() || { cols: 80, rows: 24 };
    send({ type: "create", sessionId, cols: size.cols, rows: size.rows });

    setSessions(prev => [...prev, {
      id: sessionId,
      createdAt: Date.now(),
      size: { cols: size.cols, rows: size.rows },
      clientCount: 1,
    }]);
    setCurrentSessionId(sessionId);
  }, [send]);

  const handleCloseTab = useCallback((id: string) => {
    send({ type: "kill", sessionId: id });

    setSessions(prev => {
      const newList = prev.filter(s => s.id !== id);

      if (id === currentSessionIdRef.current) {
        if (newList.length > 0) {
          const nextSession = newList[0];
          const size = terminalRef.current?.getSize() || { cols: 80, rows: 24 };
          send({ type: "attach", sessionId: nextSession.id, cols: size.cols, rows: size.rows });
          setCurrentSessionId(nextSession.id);
        } else {
          const sessionId = generateSessionId();
          const size = terminalRef.current?.getSize() || { cols: 80, rows: 24 };
          send({ type: "create", sessionId, cols: size.cols, rows: size.rows });
          setCurrentSessionId(sessionId);
          return [{
            id: sessionId,
            createdAt: Date.now(),
            size: { cols: size.cols, rows: size.rows },
            clientCount: 1,
          }];
        }
      }

      return newList;
    });
  }, [send]);

  return (
    <div className="app-container">
      <Sidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSelectTab={handleSelectTab}
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
      </div>
    </div>
  );
}

export default App;
