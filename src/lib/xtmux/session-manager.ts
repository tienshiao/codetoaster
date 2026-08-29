import type { ServerWebSocket } from "bun";
import * as os from "os";
import * as path from "path";
import type { Pty } from "./pty";
import { PtyManager } from "./pty-manager";
import type { ProjectInfo, SessionInfo, WebSocketData } from "./types";
import { formatDerivedName, uniqueName, type NameSource } from "./naming";
import { gitSpawn } from "../../api/utils";
import * as db from "../db";

function expandTilde(filepath: string): string {
  if (filepath.startsWith("~/") || filepath === "~") {
    return os.homedir() + filepath.slice(1);
  }
  return filepath;
}

// The directory half of a derived name. The home directory and the root
// both basename to something useless ("tma", ""), so they get spelled out.
export function dirLabel(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;
  // Resolve first: expandTilde("~/") yields a trailing separator, which would
  // otherwise slip past the home-directory check and basename to "tma".
  const resolved = path.resolve(cwd);
  if (resolved === os.homedir()) return "~";
  return path.basename(resolved) || "/";
}

// Naming must never be the reason a session fails to open. git may be missing
// from the daemon's PATH — Bun.spawn throws outright rather than exiting 127 —
// and a git on a stalled network mount or contending for index.lock can hang
// indefinitely. Either way the session falls back to its directory alone.
const BRANCH_LOOKUP_TIMEOUT_MS = 2000;

// The budget is for the whole lookup, not per command: a detached HEAD costs
// two git calls, and racing each one separately would let a wedged repo hold
// session creation for twice as long. gitSpawn kills the child it gives up on,
// so nothing is left running behind us.
async function branchLabel(cwd: string): Promise<string | undefined> {
  const deadline = Date.now() + BRANCH_LOOKUP_TIMEOUT_MS;
  const remainingMs = () => Math.max(1, deadline - Date.now());
  try {
    const head = await gitSpawn(cwd, ["rev-parse", "--abbrev-ref", "HEAD"], {
      timeoutMs: remainingMs(),
    });
    if (head.exitCode !== 0) return undefined;
    const branch = head.stdout.trim();
    if (!branch) return undefined;
    // Detached HEAD reports the literal "HEAD", which says less than the short
    // sha it is sitting on.
    if (branch !== "HEAD") return branch;
    const short = await gitSpawn(cwd, ["rev-parse", "--short", "HEAD"], {
      timeoutMs: remainingMs(),
    });
    return short.exitCode === 0 ? short.stdout.trim() || undefined : undefined;
  } catch {
    return undefined;
  }
}

// The label the UI shows for a session. It lives out here rather than on the
// PTY because a name is a property of the work, not of the process — in v2 it
// becomes a column on the task row, and a task keeps its name across the
// process being harvested and respawned.
interface SessionName {
  name: string;
  nameSource: NameSource;
}

// The policy half of the split (docs/v2-architecture.md §5.2): projects,
// names, and what to broadcast when something changes. Every live process and
// every client attachment belongs to the PtyManager it holds — this class
// never touches a PTY it did not ask for by id.
export class SessionManager {
  private ptys = new PtyManager();
  private names: Map<string, SessionName> = new Map();
  private projects: ProjectInfo[] = [{ id: "general", name: "General", initialPath: "", sessionIds: [] }];
  private connectedClients: Map<string, ServerWebSocket<WebSocketData>> = new Map();

  loadProjects(): void {
    const rows = db.getAllProjects();
    this.projects = rows.map((row) => ({
      id: row.id,
      name: row.name,
      initialPath: row.initial_path,
      sessionIds: [],
    }));
    // Ensure General always exists
    if (!this.projects.some((p) => p.id === "general")) {
      this.projects.unshift({ id: "general", name: "General", initialPath: "", sessionIds: [] });
    }
  }

  registerClient(clientId: string, ws: ServerWebSocket<WebSocketData>): void {
    this.connectedClients.set(clientId, ws);
  }

  unregisterClient(clientId: string): void {
    this.connectedClients.delete(clientId);
  }

  /** Whether the client's socket is still open. Worth asking before acting on
   * anything that resolved asynchronously: attaching a closed socket puts a
   * ClientInfo nothing will ever remove into the PTY's broadcast list. */
  isClientConnected(clientId: string): boolean {
    return this.connectedClients.has(clientId);
  }

  broadcastToAll(message: object): void {
    const data = JSON.stringify(message);
    for (const ws of this.connectedClients.values()) {
      ws.send(data);
    }
  }

  broadcastSessionList(): void {
    this.broadcastToAll({ type: "sessions", list: this.listSessions(), projects: this.getProjects() });
  }

  getProjects(): ProjectInfo[] {
    return this.projects.map((p) => ({
      ...p,
      sessionIds: [...p.sessionIds],
    }));
  }

  createProject(id: string, name: string, initialPath: string): void {
    if (this.projects.some((p) => p.id === id)) {
      throw new Error(`Project "${id}" already exists`);
    }
    const sortOrder = this.projects.length;
    db.createProject({ id, name, initial_path: initialPath, sort_order: sortOrder });
    this.projects.push({ id, name, initialPath, sessionIds: [] });
    this.broadcastSessionList();
  }

  updateProject(id: string, name: string, initialPath: string): boolean {
    const project = this.projects.find((p) => p.id === id);
    if (!project) return false;
    db.updateProject(id, { name, initial_path: initialPath });
    project.name = name;
    project.initialPath = initialPath;
    this.broadcastSessionList();
    return true;
  }

  deleteProject(id: string): boolean {
    if (id === "general") return false;
    const projectIndex = this.projects.findIndex((p) => p.id === id);
    if (projectIndex === -1) return false;
    const project = this.projects[projectIndex]!;
    const general = this.projects.find((p) => p.id === "general")!;
    general.sessionIds.push(...project.sessionIds);
    this.projects.splice(projectIndex, 1);
    db.deleteProject(id);
    this.broadcastSessionList();
    return true;
  }

  // cols/rows are the creator's raw measurement — spawn sanitizes them and
  // falls back on its own, so a malformed pair costs a default grid rather
  // than the session.
  async createSession(id: string, name: string | undefined, cols?: number, rows?: number, projectId?: string, afterSessionId?: string): Promise<Pty> {
    if (this.ptys.has(id)) {
      throw new Error(`Session "${id}" already exists`);
    }

    // Inherit cwd from afterSessionId's session, or from project's initialPath
    let cwd: string | undefined;
    if (afterSessionId) {
      cwd = await this.ptys.get(afterSessionId)?.getCwd();
    }
    if (!cwd && projectId) {
      const project = this.projects.find((p) => p.id === projectId);
      if (project?.initialPath) {
        cwd = expandTilde(project.initialPath);
      }
    }
    // Spelled out rather than left undefined: the PTY inherits this directory
    // either way, but the derived name can only describe a cwd it knows.
    if (!cwd) cwd = process.cwd();

    // A caller-supplied name is a deliberate choice and outranks the terminal
    // title; otherwise the session gets the derived "<dir> · <branch>" label,
    // which any title with real content will display over.
    const resolvedName = name
      ?? uniqueName(
        formatDerivedName(dirLabel(cwd), await branchLabel(cwd)),
        this.sessionNames(),
      );

    // A v1 session is a plain login shell. The Pty takes a command vector
    // rather than assuming one, which is what lets v2 spawn `claude …` through
    // the same class.
    const pty = this.ptys.spawn([process.env.SHELL || "bash"], { id, cols, rows, cwd });
    pty.onExit(() => {
      this.broadcastSessionList();
    });
    // The title is part of every session list, and clients project it over the
    // name at render time — so a title change only has to be broadcast.
    pty.onTitleChange(() => {
      this.broadcastSessionList();
    });
    pty.onActivityChange((ptyId, active) => {
      this.broadcastToAll({ type: "activity", ptyId, active });
    });
    pty.onNotification((ptyId, title, body) => {
      this.broadcastToAll({ type: "notification", ptyId, title, body });
      this.broadcastSessionList();
    });
    this.names.set(id, { name: resolvedName, nameSource: name ? "manual" : "derived" });

    // Determine target project and insertion position
    let targetProject: ProjectInfo | undefined;
    let insertAfterIndex = -1;

    if (afterSessionId) {
      // Find the project containing afterSessionId
      const afterProject = this.projects.find((p) => p.sessionIds.includes(afterSessionId));
      if (afterProject) {
        if (!projectId || projectId === afterProject.id) {
          // Insert after the session in the same project
          targetProject = afterProject;
          insertAfterIndex = afterProject.sessionIds.indexOf(afterSessionId);
        }
      }
    }

    if (!targetProject) {
      targetProject = (projectId && this.projects.find((p) => p.id === projectId))
        || this.projects.find((p) => p.id === "general")!;
    }

    if (insertAfterIndex >= 0) {
      targetProject.sessionIds.splice(insertAfterIndex + 1, 0, id);
    } else {
      targetProject.sessionIds.push(id);
    }

    return pty;
  }

  getSession(id: string): Pty | undefined {
    return this.ptys.get(id);
  }

  attachClient(
    sessionId: string,
    clientId: string,
    ws: ServerWebSocket<WebSocketData>,
    cols?: number,
    rows?: number
  ): Pty | undefined {
    return this.ptys.attach(sessionId, clientId, ws, cols, rows);
  }

  /** Detach one session, or every session the client holds when omitted (the
   * socket closed). */
  detachClient(clientId: string, sessionId?: string): void {
    this.ptys.detach(clientId, sessionId);
  }

  /** False when the client is not attached to the session it named —
   * attachment is the authorization, so the caller can report it rather than
   * dropping the keystroke silently. */
  writeToSession(clientId: string, sessionId: string, data: string): boolean {
    return this.ptys.write(clientId, sessionId, data);
  }

  /** False on the same unattached-client check as writeToSession. A stale
   * resize is not worth an error reply — a client that just detached will
   * re-measure on its next attach — but the answer is the layer below's to
   * give, not this one's to swallow. */
  resizeSession(clientId: string, sessionId: string, cols: number | null, rows: number | null): boolean {
    return this.ptys.resize(clientId, sessionId, cols, rows);
  }

  getClientSessionIds(clientId: string): string[] {
    return this.ptys.clientPtyIds(clientId);
  }

  killSession(id: string): boolean {
    if (!this.ptys.kill(id)) {
      return false;
    }
    this.names.delete(id);

    // Remove from project
    for (const project of this.projects) {
      const idx = project.sessionIds.indexOf(id);
      if (idx !== -1) {
        project.sessionIds.splice(idx, 1);
        break;
      }
    }

    return true;
  }

  renameSession(id: string, name: string): boolean {
    const record = this.names.get(id);
    if (!record) return false;
    record.name = name;
    // An explicit rename opts the session out of derivation for good.
    record.nameSource = "manual";
    this.broadcastSessionList();
    return true;
  }

  private sessionNames(): string[] {
    return [...this.names.values()].map((record) => record.name);
  }

  acknowledgeSession(sessionId: string): void {
    const pty = this.ptys.get(sessionId);
    if (pty && pty.hasNotification) {
      pty.acknowledge();
      this.broadcastSessionList();
    }
  }

  private sessionToInfo(pty: Pty, label: SessionName): SessionInfo {
    return {
      id: pty.id,
      name: label.name,
      nameSource: label.nameSource,
      title: pty.title,
      clientCount: pty.getClientCount(),
      size: pty.getSize(),
      createdAt: pty.createdAt,
      exited: pty.exited,
      hasNotification: pty.hasNotification,
    };
  }

  listSessions(): SessionInfo[] {
    const result: SessionInfo[] = [];
    for (const project of this.projects) {
      for (const id of project.sessionIds) {
        const pty = this.ptys.get(id);
        const label = this.names.get(id);
        if (pty && label) result.push(this.sessionToInfo(pty, label));
      }
    }
    return result;
  }

  getConnections(): Array<{ clientId: string; sessionIds: string[] }> {
    const result: Array<{ clientId: string; sessionIds: string[] }> = [];
    for (const clientId of this.connectedClients.keys()) {
      result.push({ clientId, sessionIds: this.getClientSessionIds(clientId) });
    }
    return result;
  }

  reorderProjects(orderedProjects: Array<{ id: string; sessionIds: string[] }>): void {
    const validSessionIds = new Set(this.ptys.ids());
    const existingProjectMap = new Map(this.projects.map((p) => [p.id, p]));
    const seenProjects = new Set<string>();
    const seenSessions = new Set<string>();
    const newProjects: ProjectInfo[] = [];

    for (const { id, sessionIds } of orderedProjects) {
      const existing = existingProjectMap.get(id);
      if (!existing || seenProjects.has(id)) continue;
      seenProjects.add(id);

      const validSessions: string[] = [];
      for (const sid of sessionIds) {
        if (validSessionIds.has(sid) && !seenSessions.has(sid)) {
          validSessions.push(sid);
          seenSessions.add(sid);
        }
      }
      newProjects.push({ ...existing, sessionIds: validSessions });
    }

    // Append missing projects
    for (const project of this.projects) {
      if (!seenProjects.has(project.id)) {
        const validSessions = project.sessionIds.filter(
          (sid) => validSessionIds.has(sid) && !seenSessions.has(sid),
        );
        for (const sid of validSessions) seenSessions.add(sid);
        newProjects.push({ ...project, sessionIds: validSessions });
        seenProjects.add(project.id);
      }
    }

    // Append orphan sessions to General
    const general = newProjects.find((p) => p.id === "general")!;
    for (const sid of validSessionIds) {
      if (!seenSessions.has(sid)) {
        general.sessionIds.push(sid);
      }
    }

    this.projects = newProjects;

    // Persist sort order to DB
    db.updateProjectOrder(
      newProjects.map((p, i) => ({ id: p.id, sort_order: i }))
    );

    this.broadcastSessionList();
  }
}

export const sessionManager = new SessionManager();
