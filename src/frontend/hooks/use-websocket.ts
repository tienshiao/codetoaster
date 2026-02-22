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
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${location.host}/terminal`);
    wsRef.current = socket;

    socket.onopen = () => {
      if (wsRef.current !== socket) return;
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
      if (wsRef.current === socket) {
        setIsConnected(false);
        wsRef.current = null;
        onDisconnectRef.current?.();
      }
    };

    return () => {
      socket.close();
    };
  }, []);

  return { send, isConnected };
}
