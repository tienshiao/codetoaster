import type { Subprocess } from "bun";
import { Terminal } from "@xterm/headless";
import { SerializeAddon } from "@xterm/addon-serialize";
import type { ClientInfo, ServerMessage, WebSocketData } from "./types";

const MIN_COLS = 80;
const MIN_ROWS = 24;

export class Session {
  public readonly id: string;
  public readonly name: string;
  public readonly createdAt: number;
  private proc: Subprocess;
  private terminal: Terminal;
  private serializeAddon: SerializeAddon;
  private clients: Map<string, ClientInfo> = new Map();
  private size: { cols: number; rows: number };
  public title: string = "";
  public exited = false;
  private exitCode: number | null = null;
  private onExitCallback?: (code: number) => void;
  private onTitleChangeCallback?: () => void;

  constructor(id: string, name: string, cols: number, rows: number) {
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

    // Spawn PTY
    this.proc = Bun.spawn([process.env.SHELL || "bash"], {
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
    if (!this.exited) {
      this.proc.terminal?.close();
      this.proc.kill();
    }
    this.terminal.dispose();
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
