import type { Subprocess } from "bun";
import { Terminal } from "@xterm/headless";
import { SerializeAddon } from "@xterm/addon-serialize";
import type { ClientInfo, ServerMessage, WebSocketData } from "./types";

const MIN_COLS = 80;
const MIN_ROWS = 24;

export class Session {
  public readonly id: string;
  public name: string;
  public readonly createdAt: number;
  private proc: Subprocess;
  private terminal: Terminal;
  private serializeAddon: SerializeAddon;
  private clients: Map<string, ClientInfo> = new Map();
  private size: { cols: number; rows: number };
  public title: string = "";
  public exited = false;
  public isActive = false;
  private exitCode: number | null = null;
  private activityTimeout: Timer | null = null;
  private onExitCallback?: (code: number) => void;
  private onTitleChangeCallback?: () => void;
  private onActivityChangeCallback?: (sessionId: string, active: boolean) => void;
  public hasNotification = false;
  private onNotificationCallback?: (sessionId: string, title: string, body: string) => void;
  private pendingOsc99: Map<string, { title: string; body: string }> = new Map();

  constructor(id: string, name: string, cols: number, rows: number, cwd?: string) {
    this.id = id;
    this.name = name;
    this.createdAt = Date.now();
    this.size = { cols: Math.max(cols, MIN_COLS), rows: Math.max(rows, MIN_ROWS) };

    // Create xterm-headless instance
    this.terminal = new Terminal({
      cols: this.size.cols,
      rows: this.size.rows,
      scrollback: 10000,
      allowProposedApi: true,
    });
    this.serializeAddon = new SerializeAddon();
    this.terminal.loadAddon(this.serializeAddon);

    this.terminal.onTitleChange((title) => {
      this.title = title;
      this.onTitleChangeCallback?.();
    });

    // OSC 777: notify;title;body
    this.terminal.parser.registerOscHandler(777, (data: string) => {
      const parts = data.split(";");
      if (parts.length >= 2 && parts[0] === "notify") {
        const title = parts[1] || "";
        const body = parts.slice(2).join(";");
        this.emitNotification(title, body);
      }
      return true;
    });

    // OSC 9: message (iTerm2/ConEmu style)
    this.terminal.parser.registerOscHandler(9, (data: string) => {
      this.emitNotification(data || "Notification", "");
      return true;
    });

    // OSC 99: Kitty desktop notification protocol (basic support)
    this.terminal.parser.registerOscHandler(99, (data: string) => {
      const semiIdx = data.indexOf(";");
      if (semiIdx === -1) return true;
      const metaStr = data.substring(0, semiIdx);
      const payload = data.substring(semiIdx + 1);

      const meta: Record<string, string> = {};
      if (metaStr) {
        for (const part of metaStr.split(":")) {
          const eqIdx = part.indexOf("=");
          if (eqIdx !== -1) {
            meta[part[0]!] = part.substring(eqIdx + 1);
          }
        }
      }

      const id = meta.i || "_default";
      const payloadType = meta.p || "title";
      const done = meta.d !== "0";

      let pending = this.pendingOsc99.get(id) || { title: "", body: "" };
      if (payloadType === "title") pending.title = payload;
      else if (payloadType === "body") pending.body = payload;

      if (done) {
        this.pendingOsc99.delete(id);
        this.emitNotification(pending.title || "Notification", pending.body);
      } else {
        this.pendingOsc99.set(id, pending);
      }
      return true;
    });

    // Spawn PTY
    this.proc = Bun.spawn([process.env.SHELL || "bash"], {
      cwd: cwd || undefined,
      terminal: {
        cols: this.size.cols,
        rows: this.size.rows,
        data: (_terminal, data) => {
          // Convert Uint8Array to string
          const str = new TextDecoder().decode(data);
          // Write to headless terminal (authoritative state)
          this.terminal.write(str);
          // Broadcast to all connected clients
          this.broadcast({ type: "data", data: str });
          // Track activity
          if (!this.isActive) {
            this.isActive = true;
            this.onActivityChangeCallback?.(this.id, true);
          }
          if (this.activityTimeout) clearTimeout(this.activityTimeout);
          this.activityTimeout = setTimeout(() => {
            this.isActive = false;
            this.onActivityChangeCallback?.(this.id, false);
          }, 300);
        },
      },
      onExit: (_proc, exitCode) => {
        this.exited = true;
        this.exitCode = exitCode ?? 0;
        this.onExitCallback?.(this.exitCode);
        this.broadcast({ type: "exit", code: this.exitCode });
      },
    });
  }

  onExit(callback: (code: number) => void): void {
    this.onExitCallback = callback;
  }

  onTitleChange(callback: () => void): void {
    this.onTitleChangeCallback = callback;
  }

  onActivityChange(callback: (sessionId: string, active: boolean) => void): void {
    this.onActivityChangeCallback = callback;
  }

  onNotification(callback: (sessionId: string, title: string, body: string) => void): void {
    this.onNotificationCallback = callback;
  }

  acknowledge(): void {
    this.hasNotification = false;
  }

  private emitNotification(title: string, body: string): void {
    this.hasNotification = true;
    this.onNotificationCallback?.(this.id, title, body);
  }

  addClient(client: ClientInfo): void {
    // Serialize BEFORE adding to broadcast list
    const serialized = this.serializeAddon.serialize();
    const buffer = this.terminal.buffer.active;
    const cursor = { x: buffer.cursorX, y: buffer.cursorY };

    // Send restore with serialized content (for scrollback history)
    this.send(client, {
      type: "restore",
      data: serialized,
      size: this.size,
      cursor,
    });
    this.send(client, { type: "attached", sessionId: this.id });

    // If session already exited, inform the new client
    if (this.exited) {
      this.send(client, { type: "exit", code: this.exitCode ?? 0 });
    }

    // Add client to broadcast list
    this.clients.set(client.id, client);

    // Recalculate terminal size
    this.recalculateSize();

  }

  removeClient(clientId: string): void {
    this.clients.delete(clientId);
    this.recalculateSize();
  }

  updateClientSize(clientId: string, cols: number, rows: number): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.size = { cols, rows };
      this.recalculateSize();
    }
  }

  write(data: string): void {
    if (this.exited) return;
    this.proc.terminal?.write(data);
  }

  kill(): void {
    if (this.activityTimeout) clearTimeout(this.activityTimeout);
    this.isActive = false;
    if (!this.exited) {
      this.proc.terminal?.close();
      this.proc.kill();
    }
    this.terminal.dispose();
  }

  async getCwd(): Promise<string | undefined> {
    if (this.exited) return undefined;
    const pid = this.proc.pid;
    try {
      if (process.platform === "darwin") {
        const result = Bun.spawnSync(["lsof", "-a", "-d", "cwd", "-Fn", "-p", String(pid)]);
        const output = result.stdout.toString();
        for (const line of output.split("\n")) {
          if (line.startsWith("n")) return line.slice(1);
        }
      } else {
        const result = Bun.spawnSync(["readlink", `/proc/${pid}/cwd`]);
        const cwd = result.stdout.toString().trim();
        if (cwd) return cwd;
      }
    } catch {
      // ignore
    }
    return undefined;
  }

  getClientCount(): number {
    return this.clients.size;
  }

  getSize(): { cols: number; rows: number } {
    return { ...this.size };
  }

  private recalculateSize(): void {
    if (this.clients.size === 0 || this.exited) {
      return;
    }

    // Smallest-wins strategy with floor of MIN_COLS x MIN_ROWS
    let cols = Infinity;
    let rows = Infinity;

    for (const client of this.clients.values()) {
      cols = Math.min(cols, client.size.cols);
      rows = Math.min(rows, client.size.rows);
    }

    cols = Math.max(cols, MIN_COLS);
    rows = Math.max(rows, MIN_ROWS);

    // Only resize if changed
    if (cols !== this.size.cols || rows !== this.size.rows) {
      this.size = { cols, rows };
      this.terminal.resize(cols, rows);
      this.proc.terminal?.resize(cols, rows);

      // Notify all clients of the new size
      this.broadcast({ type: "resize", cols, rows });
    }
  }

  private send(client: ClientInfo, message: ServerMessage): void {
    client.ws.send(JSON.stringify(message));
  }

  private broadcast(message: ServerMessage): void {
    const data = JSON.stringify(message);
    for (const client of this.clients.values()) {
      client.ws.send(data);
    }
  }
}
