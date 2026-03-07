import type { Subprocess } from "bun";
import { Terminal } from "@xterm/headless";
import { SerializeAddon } from "@xterm/addon-serialize";
import type { ClientInfo, ServerMessage, WebSocketData } from "./types";

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
  private decoder = new TextDecoder();

  constructor(id: string, name: string, cols: number, rows: number, cwd?: string) {
    this.id = id;
    this.name = name;
    this.createdAt = Date.now();
    this.size = { cols, rows };

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
    // ConEmu sub-commands: "1;msg" = notification, "4;st;pr" = progress indicator
    // iTerm2: plain text = notification
    this.terminal.parser.registerOscHandler(9, (data: string) => {
      const semiIdx = data.indexOf(";");
      if (semiIdx !== -1) {
        const sub = data.substring(0, semiIdx);
        if (sub === "1") {
          // ConEmu notification sub-command
          const msg = data.substring(semiIdx + 1);
          this.emitNotification(msg || "Notification", "");
        }
        // Ignore other sub-commands (4=progress, 2=tab title, 3=cwd, etc.)
      } else if (data) {
        // Plain text: iTerm2-style notification
        this.emitNotification(data, "");
      }
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
      env: { ...process.env, TERM: "xterm-256color" },
      terminal: {
        cols: this.size.cols,
        rows: this.size.rows,
        data: (_terminal, data) => {
          // Convert Uint8Array to string (stream: true buffers incomplete multi-byte sequences)
          const str = this.decoder.decode(data, { stream: true });
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
    const cursorHidden = (this.terminal as any)._core.coreService.isCursorHidden as boolean;
    const mouseEncoding = (this.terminal as any)._core.coreMouseService.activeEncoding as string;

    // Send restore with serialized content (for scrollback history)
    this.send(client, {
      type: "restore",
      data: serialized,
      size: this.size,
      cursor,
      cursorHidden,
      mouseEncoding,
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

  getPreviewHTML(theme?: Record<string, string>): string {
    const core = (this.terminal as any)._core;
    let prevThemeService: any;

    if (theme) {
      this.terminal.options.theme = theme;

      // The headless terminal has no _themeService, so the serialize addon
      // falls back to DEFAULT_ANSI_COLORS. Inject a fake one so the addon
      // picks up the theme's ANSI colors.
      prevThemeService = core._themeService;
      const ansiKeys = [
        "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
        "brightBlack", "brightRed", "brightGreen", "brightYellow",
        "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
      ];
      const defaultAnsi = [
        "#2e3436", "#cc0000", "#4e9a06", "#c4a000", "#3465a4", "#75507b", "#06989a", "#d3d7cf",
        "#555753", "#ef2929", "#8ae234", "#fce94f", "#729fcf", "#ad7fa8", "#34e2e2", "#eeeeec",
      ];
      const ansi: Array<{ css: string }> = ansiKeys.map((key, i) => ({
        css: (theme as any)[key] ?? defaultAnsi[i],
      }));
      // Fill remaining 240 extended colors (indices 16-255)
      const v = [0x00, 0x5f, 0x87, 0xaf, 0xd7, 0xff];
      for (let i = 0; i < 216; i++) {
        const r = v[(i / 36) % 6 | 0]!;
        const g = v[(i / 6) % 6 | 0]!;
        const b = v[i % 6]!;
        ansi.push({ css: `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}` });
      }
      for (let i = 0; i < 24; i++) {
        const c = 8 + i * 10;
        ansi.push({ css: `#${c.toString(16).padStart(2, "0")}${c.toString(16).padStart(2, "0")}${c.toString(16).padStart(2, "0")}` });
      }
      core._themeService = { colors: { ansi } };
    }

    const html = this.serializeAddon.serializeAsHTML({
      scrollback: 0,
      includeGlobalBackground: true,
    });

    if (theme) {
      core._themeService = prevThemeService;
    }
    return html;
  }

  private recalculateSize(): void {
    if (this.clients.size === 0 || this.exited) {
      return;
    }

    // Smallest-wins strategy
    let cols = Infinity;
    let rows = Infinity;

    for (const client of this.clients.values()) {
      cols = Math.min(cols, client.size.cols);
      rows = Math.min(rows, client.size.rows);
    }

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
