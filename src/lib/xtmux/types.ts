import type { ServerWebSocket } from "bun";
import type { NameSource } from "./naming";

export interface ProjectInfo {
  id: string;
  name: string;
  initialPath: string;
  sessionIds: string[];
}

// Client -> Server messages
//
// Terminal traffic is addressed by ptyId, the id of the pseudo-terminal it
// belongs to. One client can hold several PTYs open at once (one per terminal
// tab), and never shows the same PTY twice — so clientId stays unique within a
// PTY's client map and no separate view id is needed, which is what makes
// `${clientId}:${ptyId}` a sufficient connection address
// (docs/v2-architecture.md §5.3).
//
// In v1 a session *is* a PTY, so these are still one id. The names diverge in
// Phase 1 proper, when a task gains its own id and can outlive its process.
export type ClientMessage =
  | { type: "create"; ptyId: string; name?: string; cols: number; rows: number; projectId?: string; afterSessionId?: string }
  | { type: "attach"; ptyId: string; cols?: number; rows?: number }
  // Without a ptyId, detaches the client from every PTY it holds.
  | { type: "detach"; ptyId?: string }
  | { type: "input"; ptyId: string; data: string }
  // null cols/rows mean "this client is no longer measuring this PTY" — a
  // terminal in a hidden tab, which must keep receiving output without
  // constraining smallest-wins negotiation with its stale layout.
  | { type: "resize"; ptyId: string; cols: number | null; rows: number | null }
  | { type: "list" }
  | { type: "kill"; ptyId: string }
  | { type: "rename"; ptyId: string; name: string }
  | { type: "acknowledge"; ptyId: string }
  | { type: "reorder"; projects: Array<{ id: string; sessionIds: string[] }> }
  | { type: "createProject"; id: string; name: string; initialPath: string }
  | { type: "updateProject"; id: string; name: string; initialPath: string }
  | { type: "deleteProject"; id: string };

// Server -> Client messages
export type ServerMessage =
  | { type: "attached"; ptyId: string }
  | { type: "restore"; ptyId: string; data: string; size: { cols: number; rows: number }; cursor: { x: number; y: number }; cursorHidden: boolean; mouseEncoding: string }
  | { type: "data"; ptyId: string; data: string }
  | { type: "resize"; ptyId: string; cols: number; rows: number }
  | { type: "exit"; ptyId: string; code: number }
  | { type: "error"; message: string }
  | { type: "sessions"; list: SessionInfo[]; projects: ProjectInfo[] }
  | { type: "activity"; ptyId: string; active: boolean }
  | { type: "notification"; ptyId: string; title: string; body: string };

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
