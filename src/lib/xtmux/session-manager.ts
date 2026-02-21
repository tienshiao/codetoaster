import type { ServerWebSocket } from "bun";
import { Session } from "./session";
import type { ClientInfo, SessionInfo, WebSocketData } from "./types";

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private clientToSession: Map<string, string> = new Map();

  createSession(id: string, name: string, cols: number, rows: number): Session {
    if (this.sessions.has(id)) {
      throw new Error(`Session "${id}" already exists`);
    }

    const session = new Session(id, name, cols, rows);
    session.onExit(() => {
      this.sessions.delete(id);
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

  listSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).map((session) => ({
      id: session.id,
      name: session.name,
      clientCount: session.getClientCount(),
      size: session.getSize(),
      createdAt: session.createdAt,
    }));
  }
}

export const sessionManager = new SessionManager();
