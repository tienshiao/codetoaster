import type { ServerWebSocket } from "bun";
import type { NameSource } from "./naming";

export interface ProjectInfo {
  id: string;
  name: string;
  initialPath: string;
  sessionIds: string[];
}

// Client -> Server messages
export type ClientMessage =
  | { type: "create"; sessionId: string; name?: string; cols: number; rows: number; projectId?: string; afterSessionId?: string }
  // Every terminal message is addressed by sessionId: one client can hold
  // several sessions open at once (one per terminal tab). A client never shows
  // the same session twice, so clientId stays unique within a session's client
  // map and no separate view id is needed. See docs/v2-architecture.md §5.3.
  | { type: "attach"; sessionId: string; cols?: number; rows?: number }
  // Without a sessionId, detaches the client from every session it holds.
  | { type: "detach"; sessionId?: string }
  | { type: "input"; sessionId: string; data: string }
  // null cols/rows mean "this client is no longer measuring the session" — a
  // terminal in a hidden tab, which must keep receiving output without
  // constraining smallest-wins negotiation with its stale layout.
  | { type: "resize"; sessionId: string; cols: number | null; rows: number | null }
  | { type: "list" }
  | { type: "kill"; sessionId: string }
  | { type: "rename"; sessionId: string; name: string }
  | { type: "acknowledge"; sessionId: string }
  | { type: "reorder"; projects: Array<{ id: string; sessionIds: string[] }> }
  | { type: "createProject"; id: string; name: string; initialPath: string }
  | { type: "updateProject"; id: string; name: string; initialPath: string }
  | { type: "deleteProject"; id: string };

// Server -> Client messages
export type ServerMessage =
  | { type: "attached"; sessionId: string }
  | { type: "restore"; sessionId: string; data: string; size: { cols: number; rows: number }; cursor: { x: number; y: number }; cursorHidden: boolean; mouseEncoding: string }
  | { type: "data"; sessionId: string; data: string }
  | { type: "resize"; sessionId: string; cols: number; rows: number }
  | { type: "exit"; sessionId: string; code: number }
  | { type: "error"; message: string }
  | { type: "sessions"; list: SessionInfo[]; projects: ProjectInfo[] }
  | { type: "activity"; sessionId: string; active: boolean }
  | { type: "notification"; sessionId: string; title: string; body: string };

export interface SessionInfo {
  id: string;
  name: string;
  nameSource: NameSource;
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
  // null until the client has measured its terminal against a visible
  // container; sizeless clients don't constrain smallest-wins negotiation
  size: { cols: number; rows: number } | null;
}

export interface WebSocketData {
  clientId: string;
}
