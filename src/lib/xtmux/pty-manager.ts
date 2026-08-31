import type { ServerWebSocket } from "bun";
import { Pty, sanitizeSize, type PtyOptions } from "./pty";
import type { ClientInfo, WebSocketData } from "./types";

export interface SpawnOptions extends PtyOptions {
  /** The id to give the PTY. Generated when omitted — v1 lets the client pick
   * it, because the same id is the session's slug and route. */
  id?: string;
  cols?: number;
  rows?: number;
}

const DEFAULT_SIZE = { cols: 80, rows: 24 };

// The process layer (docs/v2-architecture.md §5.2). It owns live PTYs and the
// attachments clients hold on them — nothing else. It has no notion of tasks,
// names, worktrees, or git, which is what lets the same class carry an agent
// and a plain shell without caring which is which.
export class PtyManager {
  private ptys: Map<string, Pty> = new Map();
  // A client holds one attachment per PTY it is showing — one terminal tab
  // each. It never shows the same PTY twice, so the set never needs to
  // distinguish two views of one PTY (§5.3).
  private clientPtys: Map<string, Set<string>> = new Map();

  /** Spawns the command on a new PTY and returns it; its id is `pty.id`. */
  spawn(command: string[], options: SpawnOptions = {}): Pty {
    const { id = crypto.randomUUID(), cols, rows, ...ptyOptions } = options;
    if (this.ptys.has(id)) {
      throw new Error(`PTY "${id}" already exists`);
    }
    // A PTY needs a concrete initial size, so a missing or malformed one falls
    // back rather than failing the spawn; attach re-sanitizes the client's own
    // measurement, so this fallback never enters negotiation as anyone's size.
    const size = sanitizeSize(cols, rows) ?? DEFAULT_SIZE;
    const pty = new Pty(id, command, size.cols, size.rows, ptyOptions);
    this.ptys.set(id, pty);
    return pty;
  }

  get(ptyId: string): Pty | undefined {
    return this.ptys.get(ptyId);
  }

  has(ptyId: string): boolean {
    return this.ptys.has(ptyId);
  }

  ids(): string[] {
    return [...this.ptys.keys()];
  }

  attach(
    ptyId: string,
    clientId: string,
    ws: ServerWebSocket<WebSocketData>,
    cols?: number,
    rows?: number,
  ): Pty | undefined {
    const pty = this.ptys.get(ptyId);
    if (!pty) return undefined;

    // Attaching does not detach whatever the client already had: a client can
    // hold several PTYs at once. Re-attaching to one it already holds is still
    // valid (a remount) and replaces the entry, which re-sends restore.
    const client: ClientInfo = { id: clientId, ws, size: sanitizeSize(cols, rows) };
    pty.addClient(client);

    let held = this.clientPtys.get(clientId);
    if (!held) {
      held = new Set();
      this.clientPtys.set(clientId, held);
    }
    held.add(ptyId);
    return pty;
  }

  /** Detach one PTY, or every PTY the client holds when omitted (the socket
   * closed). Returns the PTYs actually detached — a caller that has to tell
   * anyone the audience shrank needs to know which ones, and naming a PTY the
   * client never held detaches nothing. */
  detach(clientId: string, ptyId?: string): string[] {
    const held = this.clientPtys.get(clientId);
    if (!held) return [];
    const targets = ptyId === undefined ? [...held] : held.has(ptyId) ? [ptyId] : [];
    for (const id of targets) {
      this.ptys.get(id)?.removeClient(clientId);
      held.delete(id);
    }
    if (held.size === 0) this.clientPtys.delete(clientId);
    return targets;
  }

  /** The PTY only if this client is attached to it. Attachment is the
   * authorization: naming a PTY you never opened must not hand you a writable
   * one. */
  forClient(clientId: string, ptyId: string): Pty | undefined {
    if (!this.clientPtys.get(clientId)?.has(ptyId)) return undefined;
    return this.ptys.get(ptyId);
  }

  clientPtyIds(clientId: string): string[] {
    return [...(this.clientPtys.get(clientId) ?? [])];
  }

  /** False when the client is not attached, so the caller can say so rather
   * than dropping the keystroke silently. */
  write(clientId: string, ptyId: string, data: string): boolean {
    const pty = this.forClient(clientId, ptyId);
    if (!pty) return false;
    pty.write(data);
    return true;
  }

  /** A null cols/rows pair means the client has stopped measuring this PTY —
   * a terminal in a hidden tab, which keeps receiving output without
   * constraining smallest-wins negotiation with its stale layout. */
  resize(clientId: string, ptyId: string, cols: number | null, rows: number | null): boolean {
    const pty = this.forClient(clientId, ptyId);
    if (!pty) return false;
    pty.updateClientSize(clientId, cols, rows);
    return true;
  }

  kill(ptyId: string): boolean {
    const pty = this.ptys.get(ptyId);
    if (!pty) return false;
    pty.kill();
    this.ptys.delete(ptyId);
    // Forget it on behalf of every client that held it, dropping clients left
    // holding nothing.
    for (const [clientId, held] of this.clientPtys) {
      if (held.delete(ptyId) && held.size === 0) {
        this.clientPtys.delete(clientId);
      }
    }
    return true;
  }

  killAll(): void {
    for (const ptyId of this.ids()) this.kill(ptyId);
  }
}
