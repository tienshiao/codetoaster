import { useState, useRef, useCallback, useEffect } from "react";

interface UseWebSocketOptions {
  onMessage: (message: any) => void;
  onConnect: () => void;
  onDisconnect?: () => void;
}

export function useWebSocket({ onMessage, onConnect, onDisconnect }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const onMessageRef = useRef(onMessage);
  const onConnectRef = useRef(onConnect);
  const onDisconnectRef = useRef(onDisconnect);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(1000);
  const unmountedRef = useRef(false);

  onMessageRef.current = onMessage;
  onConnectRef.current = onConnect;
  onDisconnectRef.current = onDisconnect;

  const send = useCallback((msg: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    unmountedRef.current = false;

    function connect() {
      if (unmountedRef.current) return;

      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${location.host}/terminal`);
      wsRef.current = socket;

      socket.onopen = () => {
        if (wsRef.current !== socket) return;
        backoffRef.current = 1000; // Reset backoff on successful connection
        setIsConnected(true);
        onConnectRef.current();
      };

      socket.onmessage = (e) => {
        if (wsRef.current !== socket) return;
        let message;
        try {
          message = JSON.parse(e.data);
        } catch {
          return;
        }
        onMessageRef.current(message);
      };

      socket.onclose = () => {
        if (wsRef.current !== socket) return;
        setIsConnected(false);
        wsRef.current = null;
        onDisconnectRef.current?.();

        // Schedule reconnection with exponential backoff + jitter
        if (!unmountedRef.current) {
          const base = backoffRef.current;
          const jitter = base * (0.7 + Math.random() * 0.6); // ±30%
          reconnectTimerRef.current = setTimeout(connect, jitter);
          backoffRef.current = Math.min(base * 2, 30000);
        }
      };
    }

    connect();

    return () => {
      unmountedRef.current = true;
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      wsRef.current?.close();
    };
  }, []);

  return { send, isConnected };
}
