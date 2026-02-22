import type { ServerWebSocket } from "bun";
import { Session } from "./session";
import type { ClientInfo, SessionInfo, WebSocketData } from "./types";

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
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

  listSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).map((session) => ({
      id: session.id,
      name: session.name,
      title: session.title,
      clientCount: session.getClientCount(),
      size: session.getSize(),
      createdAt: session.createdAt,
      exited: session.exited,
      hasNotification: session.hasNotification,
    }));
  }
}

export const sessionManager = new SessionManager();
