import type { ServerWebSocket } from "bun";

export interface ProjectInfo {
  id: string;
  name: string;
  initialPath: string;
  color: string;
  sessionIds: string[];
}

// Client -> Server messages
export type ClientMessage =
  | { type: "create"; sessionId: string; name?: string; cols: number; rows: number; projectId?: string; afterSessionId?: string }
  | { type: "attach"; sessionId: string; cols: number; rows: number }
  | { type: "detach" }
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "list" }
  | { type: "kill"; sessionId: string }
  | { type: "rename"; sessionId: string; name: string }
  | { type: "acknowledge"; sessionId: string }
  | { type: "reorder"; projects: Array<{ id: string; sessionIds: string[] }> }
  | { type: "createProject"; id: string; name: string; initialPath: string; color: string }
  | { type: "updateProject"; id: string; name: string; initialPath: string; color: string }
  | { type: "deleteProject"; id: string };

// Server -> Client messages
export type ServerMessage =
  | { type: "attached"; sessionId: string }
  | { type: "restore"; data: string; size: { cols: number; rows: number }; cursor: { x: number; y: number }; cursorHidden: boolean }
  | { type: "data"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "exit"; code: number }
  | { type: "error"; message: string }
  | { type: "sessions"; list: SessionInfo[]; projects: ProjectInfo[] }
  | { type: "activity"; sessionId: string; active: boolean }
  | { type: "notification"; sessionId: string; title: string; body: string };

export interface SessionInfo {
  id: string;
  name: string;
  title: string;
  clientCount: number;
  size: { cols: number; rows: number };
  createdAt: number;
  exited: boolean;
  hasNotification: boolean;
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
