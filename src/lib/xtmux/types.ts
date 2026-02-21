import type { ServerWebSocket } from "bun";

// Client -> Server messages
export type ClientMessage =
  | { type: "create"; sessionId: string; name?: string; cols: number; rows: number }
  | { type: "attach"; sessionId: string; cols: number; rows: number }
  | { type: "detach" }
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "list" }
  | { type: "kill"; sessionId: string };

// Server -> Client messages
export type ServerMessage =
  | { type: "attached"; sessionId: string }
  | { type: "restore"; data: string; size: { cols: number; rows: number }; cursor: { x: number; y: number } }
  | { type: "data"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "exit"; code: number }
  | { type: "error"; message: string }
  | { type: "sessions"; list: SessionInfo[] };

export interface SessionInfo {
  id: string;
  name: string;
  title: string;
  clientCount: number;
  size: { cols: number; rows: number };
  createdAt: number;
  exited: boolean;
}

export interface ClientInfo {
  id: string;
  ws: ServerWebSocket<WebSocketData>;
  size: { cols: number; rows: number };
}

export interface WebSocketData {
  clientId: string;
  sessionId: string | null;
}
