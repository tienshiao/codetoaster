import type { ServerWebSocket } from "bun";
import { Session } from "./session";
import type { ClientInfo, FolderInfo, SessionInfo, WebSocketData } from "./types";

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private folders: FolderInfo[] = [{ id: "general", name: "General", sessionIds: [] }];
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
    this.broadcastToAll({ type: "sessions", list: this.listSessions(), folders: this.getFolders() });
  }

  getFolders(): FolderInfo[] {
    return this.folders.map((f) => ({ ...f, sessionIds: [...f.sessionIds] }));
  }

  createFolder(id: string, name: string): void {
    if (this.folders.some((f) => f.id === id)) {
      throw new Error(`Folder "${id}" already exists`);
    }
    this.folders.push({ id, name, sessionIds: [] });
    this.broadcastSessionList();
  }

  renameFolder(id: string, name: string): boolean {
    const folder = this.folders.find((f) => f.id === id);
    if (!folder) return false;
    folder.name = name;
    this.broadcastSessionList();
    return true;
  }

  deleteFolder(id: string): boolean {
    if (id === "general") return false;
    const folderIndex = this.folders.findIndex((f) => f.id === id);
    if (folderIndex === -1) return false;
    const folder = this.folders[folderIndex]!;
    const general = this.folders.find((f) => f.id === "general")!;
    general.sessionIds.push(...folder.sessionIds);
    this.folders.splice(folderIndex, 1);
    this.broadcastSessionList();
    return true;
  }

  createSession(id: string, name: string, cols: number, rows: number, folderId?: string): Session {
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

    const targetFolder = (folderId && this.folders.find((f) => f.id === folderId))
      || this.folders.find((f) => f.id === "general")!;
    targetFolder.sessionIds.push(id);

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

    // Remove from folder
    for (const folder of this.folders) {
      const idx = folder.sessionIds.indexOf(id);
      if (idx !== -1) {
        folder.sessionIds.splice(idx, 1);
        break;
      }
    }

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
    for (const folder of this.folders) {
      for (const id of folder.sessionIds) {
        const session = this.sessions.get(id);
        if (session) result.push(this.sessionToInfo(session));
      }
    }
    return result;
  }

  reorderFolders(orderedFolders: Array<{ id: string; sessionIds: string[] }>): void {
    const validSessionIds = new Set(this.sessions.keys());
    const existingFolderMap = new Map(this.folders.map((f) => [f.id, f]));
    const seenFolders = new Set<string>();
    const seenSessions = new Set<string>();
    const newFolders: FolderInfo[] = [];

    for (const { id, sessionIds } of orderedFolders) {
      const existing = existingFolderMap.get(id);
      if (!existing || seenFolders.has(id)) continue;
      seenFolders.add(id);

      const validSessions: string[] = [];
      for (const sid of sessionIds) {
        if (validSessionIds.has(sid) && !seenSessions.has(sid)) {
          validSessions.push(sid);
          seenSessions.add(sid);
        }
      }
      newFolders.push({ id, name: existing.name, sessionIds: validSessions });
    }

    // Append missing folders
    for (const folder of this.folders) {
      if (!seenFolders.has(folder.id)) {
        const validSessions = folder.sessionIds.filter(
          (sid) => validSessionIds.has(sid) && !seenSessions.has(sid),
        );
        for (const sid of validSessions) seenSessions.add(sid);
        newFolders.push({ id: folder.id, name: folder.name, sessionIds: validSessions });
        seenFolders.add(folder.id);
      }
    }

    // Append orphan sessions to General
    const general = newFolders.find((f) => f.id === "general")!;
    for (const sid of validSessionIds) {
      if (!seenSessions.has(sid)) {
        general.sessionIds.push(sid);
      }
    }

    this.folders = newFolders;
    this.broadcastSessionList();
  }
}

export const sessionManager = new SessionManager();
