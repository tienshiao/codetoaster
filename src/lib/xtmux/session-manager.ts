import type { ServerWebSocket } from "bun";
import { Session } from "./session";
import type { ClientInfo, SessionInfo, WebSocketData } from "./types";

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private sessionOrder: string[] = [];
  private clientToSession: Map<string, string> = new Map();
  private connectedClients: Map<string, ServerWebSocket<WebSocketData>> = new Map();

  registerClient(clientId: string, ws: ServerWebSocket<WebSocketData>): void {
    this.connectedClients.set(clientId, ws);
  }

  unregisterClient(clientId: string): void {
    this.connectedClients.delete(clientId);
  }

  broadcastToAll(message: object): void {
    const data = JSON.stringify(message);
    for (const ws of this.connectedClients.values()) {
      ws.send(data);
    }
  }

  broadcastSessionList(): void {
    this.broadcastToAll({ type: "sessions", list: this.listSessions() });
  }

  createSession(id: string, name: string, cols: number, rows: number): Session {
    if (this.sessions.has(id)) {
      throw new Error(`Session "${id}" already exists`);
    }

    const session = new Session(id, name, cols, rows);
    session.onExit(() => {
      this.broadcastSessionList();
    });
    session.onTitleChange(() => {
      this.broadcastSessionList();
    });
    session.onActivityChange((sessionId, active) => {
      this.broadcastToAll({ type: "activity", sessionId, active });
    });
    session.onNotification((sessionId, title, body) => {
      this.broadcastToAll({ type: "notification", sessionId, title, body });
      this.broadcastSessionList();
    });
    this.sessions.set(id, session);
    this.sessionOrder.push(id);
    return session;
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  attachClient(
    sessionId: string,
    clientId: string,
    ws: ServerWebSocket<WebSocketData>,
    cols: number,
    rows: number
  ): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    // Detach from any existing session first
    this.detachClient(clientId);

    const client: ClientInfo = {
      id: clientId,
      ws,
      size: { cols, rows },
    };

    session.addClient(client);
    this.clientToSession.set(clientId, sessionId);
    return session;
  }

  detachClient(clientId: string): void {
    const sessionId = this.clientToSession.get(clientId);
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      session?.removeClient(clientId);
      this.clientToSession.delete(clientId);
    }
  }

  getClientSession(clientId: string): Session | undefined {
    const sessionId = this.clientToSession.get(clientId);
    if (sessionId) {
      return this.sessions.get(sessionId);
    }
    return undefined;
  }

  killSession(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) {
      return false;
    }

    session.kill();
    this.sessions.delete(id);
    this.sessionOrder = this.sessionOrder.filter((sid) => sid !== id);

    // Remove all client mappings for this session
    for (const [clientId, sessionId] of this.clientToSession) {
      if (sessionId === id) {
        this.clientToSession.delete(clientId);
      }
    }

    return true;
  }

  renameSession(id: string, name: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.name = name;
    this.broadcastSessionList();
    return true;
  }

  acknowledgeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session && session.hasNotification) {
      session.acknowledge();
      this.broadcastSessionList();
    }
  }

  private sessionToInfo(session: Session): SessionInfo {
    return {
      id: session.id,
      name: session.name,
      title: session.title,
      clientCount: session.getClientCount(),
      size: session.getSize(),
      createdAt: session.createdAt,
      exited: session.exited,
      hasNotification: session.hasNotification,
    };
  }

  listSessions(): SessionInfo[] {
    const result: SessionInfo[] = [];
    for (const id of this.sessionOrder) {
      const session = this.sessions.get(id);
      if (session) result.push(this.sessionToInfo(session));
    }
    return result;
  }

  reorderSessions(orderedIds: string[]): void {
    const validIds = new Set(this.sessions.keys());
    const seen = new Set<string>();
    const newOrder: string[] = [];

    for (const id of orderedIds) {
      if (validIds.has(id) && !seen.has(id)) {
        newOrder.push(id);
        seen.add(id);
      }
    }

    // Append any sessions not in the provided order
    for (const id of this.sessionOrder) {
      if (!seen.has(id) && validIds.has(id)) {
        newOrder.push(id);
      }
    }

    this.sessionOrder = newOrder;
    this.broadcastSessionList();
  }
}

export const sessionManager = new SessionManager();
