import type { Subprocess } from "bun";
import { readlink } from "node:fs/promises";
import { Terminal } from "@xterm/headless";
import { SerializeAddon } from "@xterm/addon-serialize";
import type { ClientInfo, ServerMessage } from "./types";

// Validate a client-reported terminal size. Messages are parsed from the wire,
// so cols/rows can be anything (null, NaN, 0, floats, absurd values) — treat
// everything that isn't a workable integer pair as "no measurement" rather
// than letting it into smallest-wins negotiation, where Math.min would coerce
// it and resize every client's terminal to garbage.
export function sanitizeSize(cols: unknown, rows: unknown): { cols: number; rows: number } | null {
  if (
    typeof cols !== "number" || !Number.isInteger(cols) || cols < 2 || cols > 10000 ||
    typeof rows !== "number" || !Number.isInteger(rows) || rows < 1 || rows > 10000
  ) {
    return null;
  }
  return { cols, rows };
}

// How long `ps` / `lsof` get to answer where a process is before the answer is
// written off as unknowable. Generous for a healthy machine, and the only
// thing standing between a stalled network mount and a request that never
// returns.
const LOOKUP_TIMEOUT_MS = 2000;

export interface PtyOptions {
  cwd?: string;
  // Merged over the PTY's own defaults ({ ...process.env, TERM }), so a caller
  // can both add variables and remove inherited ones by naming them undefined.
  env?: Record<string, string | undefined>;
}

// A pseudo-terminal and the authoritative view of what it has painted. It
// knows nothing about tasks, naming, or worktrees: what it is running is a
// command vector its owner chose — `claude …` for an agent, $SHELL for a plain
// terminal — and who it is for is a set of attached clients.
export class Pty {
  public readonly id: string;
  public readonly createdAt: number;
  private proc: Subprocess;
  private terminal: Terminal;
  private serializeAddon: SerializeAddon;
  // Keyed by connection, `${clientId}:${ptyId}` — the address a terminal view
  // has on the wire (docs/v2-architecture.md §5.3). A client shows any given
  // PTY at most once, so clientId alone would still be unique inside one PTY's
  // map; spelling out the full key keeps an entry meaningful when it is read
  // outside the PTY that holds it.
  private clients: Map<string, ClientInfo> = new Map();
  private size: { cols: number; rows: number };
  public title: string = "";
  public exited = false;
  // Whether the headless terminal has been torn down. Not the same thing as
  // `exited`: a PTY whose process died on its own still holds the buffer the
  // agent painted its last output into, and that is exactly what a snapshot
  // wants. Only `kill` ends the buffer.
  private disposed = false;
  public isActive = false;
  private exitCode: number | null = null;
  private activityTimeout: Timer | null = null;
  private onExitCallback?: (code: number) => void;
  private onTitleChangeCallback?: () => void;
  private onActivityChangeCallback?: (ptyId: string, active: boolean) => void;
  public hasNotification = false;
  private onNotificationCallback?: (ptyId: string, title: string, body: string) => void;
  private pendingOsc99: Map<string, { title: string; body: string }> = new Map();
  private decoder = new TextDecoder();

  constructor(id: string, command: string[], cols: number, rows: number, options: PtyOptions = {}) {
    if (command.length === 0) throw new Error("Pty needs a command to run");
    this.id = id;
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
    this.proc = Bun.spawn(command, {
      cwd: options.cwd || undefined,
      env: { ...process.env, TERM: "xterm-256color", ...options.env },
      terminal: {
        cols: this.size.cols,
        rows: this.size.rows,
        data: (_terminal, data) => {
          // Convert Uint8Array to string (stream: true buffers incomplete multi-byte sequences)
          const str = this.decoder.decode(data, { stream: true });
          // Write to headless terminal (authoritative state)
          this.terminal.write(str);
          // Broadcast to all connected clients
          this.broadcast({ type: "data", ptyId: this.id, data: str });
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
        // The same falling edge `kill` sends, for the same reason: a process
        // that dies on its own inside the 300ms debounce window leaves a
        // pending timeout that will fire against a dead PTY, and nothing after
        // it can ever produce another activity message — so the sidebar keeps a
        // live dot on a task whose agent has exited.
        if (this.activityTimeout) clearTimeout(this.activityTimeout);
        if (this.isActive) {
          this.isActive = false;
          this.onActivityChangeCallback?.(this.id, false);
        }
        this.onExitCallback?.(this.exitCode);
        this.broadcast({ type: "exit", ptyId: this.id, code: this.exitCode });
      },
    });
  }

  onExit(callback: (code: number) => void): void {
    this.onExitCallback = callback;
  }

  onTitleChange(callback: () => void): void {
    this.onTitleChangeCallback = callback;
  }

  onActivityChange(callback: (ptyId: string, active: boolean) => void): void {
    this.onActivityChangeCallback = callback;
  }

  onNotification(callback: (ptyId: string, title: string, body: string) => void): void {
    this.onNotificationCallback = callback;
  }

  acknowledge(): void {
    this.hasNotification = false;
  }

  private emitNotification(title: string, body: string): void {
    this.hasNotification = true;
    this.onNotificationCallback?.(this.id, title, body);
  }

  /** The screen and its scrollback as the ANSI a terminal would replay to get
   * back here — what a reattaching client is restored from, and what the idle
   * harvester writes to disk (TASK-14, docs/v2-architecture.md §5.1).
   *
   * Empty once the terminal is gone rather than throwing. Harvesting is
   * snapshot-then-kill, so a serialize that lands on the far side of a dispose
   * is an ordering hazard the caller cannot see coming — and it would throw out
   * of a background interval, taking the rest of the tick's tasks with it.
   * Answering "" makes that hazard inert instead of fatal. */
  serialize(): string {
    if (this.disposed) return "";
    return this.serializeAddon.serialize();
  }

  /** Whether `serialize` still has a terminal behind it. The empty string above
   * is a safe answer for a client being restored — it repaints nothing — but a
   * ruinous one for anything that *stores* it: writing "" over a good snapshot
   * destroys the last screen this PTY ever painted, which is precisely what the
   * snapshot exists to keep. A caller that persists the answer asks this
   * first, and treats a torn-down terminal as nothing to write rather than as
   * an empty screen. */
  get isDisposed(): boolean {
    return this.disposed;
  }

  addClient(client: ClientInfo): void {
    // Serialize BEFORE adding to broadcast list
    const serialized = this.serialize();
    const buffer = this.terminal.buffer.active;
    const cursor = { x: buffer.cursorX, y: buffer.cursorY };
    const cursorHidden = (this.terminal as any)._core.coreService.isCursorHidden as boolean;
    const mouseEncoding = (this.terminal as any)._core.coreMouseService.activeEncoding as string;

    // Send restore with serialized content (for scrollback history)
    this.send(client, {
      type: "restore",
      ptyId: this.id,
      data: serialized,
      size: this.size,
      cursor,
      cursorHidden,
      mouseEncoding,
    });
    // `attached` is not sent from here: it names the task this terminal
    // belongs to, and a Pty has no notion of one. TaskManager sends it once
    // the attachment is recorded.

    // If session already exited, inform the new client
    if (this.exited) {
      this.send(client, { type: "exit", ptyId: this.id, code: this.exitCode ?? 0 });
    }

    // Add client to broadcast list
    this.clients.set(this.connectionKey(client.id), client);

    // Recalculate terminal size
    this.recalculateSize();

  }

  removeClient(clientId: string): void {
    this.clients.delete(this.connectionKey(clientId));
    this.recalculateSize();
  }

  private connectionKey(clientId: string): string {
    return `${clientId}:${this.id}`;
  }

  // A null cols/rows pair clears this client's measurement rather than being
  // rejected as garbage: a terminal whose tab was just hidden must stop
  // constraining negotiation, but stays attached and keeps receiving output.
  // Anything else unparseable is still ignored outright (sanitizeSize).
  updateClientSize(clientId: string, cols: number | null, rows: number | null): void {
    const client = this.clients.get(this.connectionKey(clientId));
    if (!client) return;
    if (cols === null || rows === null) {
      if (client.size === null) return;
      client.size = null;
      this.recalculateSize();
      return;
    }
    const size = sanitizeSize(cols, rows);
    if (size) {
      client.size = size;
      this.recalculateSize();
    }
  }

  write(data: string): void {
    if (this.exited) return;
    this.proc.terminal?.write(data);
  }

  kill(): void {
    if (this.activityTimeout) clearTimeout(this.activityTimeout);
    // Announce the activity drop instead of just clearing the flag. Activity is
    // edge-triggered on the wire: a client turns its dot on when `active:true`
    // arrives and off only when a later `active:false` does. Killing a PTY
    // inside the 300ms debounce window — a resume-ladder rung that prints its
    // error and is torn down immediately after — cancels the timeout that would
    // have sent the falling edge, and no further output can ever produce one,
    // so the sidebar keeps a live dot on a task with no process behind it for
    // the rest of the daemon's life.
    const wasActive = this.isActive;
    this.isActive = false;
    if (wasActive) this.onActivityChangeCallback?.(this.id, false);
    if (!this.exited) {
      this.proc.terminal?.close();
      this.proc.kill();
    }
    // Guarded because kill is safe to ask for twice — the resume ladder
    // discards a rung that a client is also detaching from — and disposing an
    // already-disposed terminal is not.
    if (!this.disposed) {
      this.disposed = true;
      this.terminal.dispose();
    }
  }

  async getCwd(): Promise<string | undefined> {
    if (this.exited) return undefined;
    const shellPid = this.proc.pid;
    // Prefer the cwd of the terminal's foreground process group. A program like
    // `claude --worktree` chdir's into a git worktree while the session shell
    // stays put, so the foreground process's cwd is what the user perceives as
    // "where they are". Fall back to the shell's own cwd.
    const fgPid = await this.getForegroundPid(shellPid);
    if (fgPid && fgPid !== shellPid) {
      const fgCwd = await this.cwdForPid(fgPid);
      if (fgCwd) return fgCwd;
    }
    return this.cwdForPid(shellPid);
  }

  /** Whether something other than the terminal's own program holds the
   * foreground — a command the user left running in a shell tab, an editor, a
   * build (docs/v2-architecture.md §5.5). What the idle harvester asks before
   * it kills a task's terminals.
   *
   * An answer it could not get is `true`. `getForegroundPid` reports "ps
   * failed", "ps was killed on the timeout" and "ps said something
   * unparseable" as the same undefined, and every one of those means we do not
   * know what is running in there — §9's risk 3 is "when in doubt, do not
   * harvest", and could-not-tell is doubt. Reading it the other way would make
   * a wedged mount or a missing `ps` into a reason to kill the user's work,
   * which is the one failure this whole guard exists to prevent.
   *
   * A process that has already exited holds nothing, and is the one case where
   * "no foreground" is knowledge rather than a guess. */
  async hasForegroundProcess(): Promise<boolean> {
    if (this.exited) return false;
    const shellPid = this.proc.pid;
    const fgPid = await this.getForegroundPid(shellPid);
    if (fgPid === undefined) return true;
    return fgPid !== shellPid;
  }

  // Run a helper and hand back what it printed, or "" for anything that went
  // wrong — a non-zero exit, or a tool that is not installed, which makes
  // Bun.spawn throw before there is a process at all. Every caller below reads
  // an absent answer out of an empty string, so failures stay indistinguishable
  // from "could not tell", and getCwd() resolves to undefined rather than
  // rejecting the way its callers assume it never does.
  //
  // Bun.spawn rather than Bun.spawnSync, and this is the whole point of the
  // helper: `ps` and `lsof` are slow enough to notice, and spawnSync blocks the
  // daemon's single event loop for their whole duration. Since TaskManager
  // refreshes the cwd on every client attach, that turned each terminal tab
  // switch into a stall in which no PTY output reached any client and every
  // HTTP route sat waiting. Bun.$ would do this too, but it is banned here
  // (CLAUDE.md) for deadlocking on large output.
  //
  // Bounded, for the same reason gitSpawn is: `lsof` on a wedged mount does not
  // return, and getCwd() now sits in front of every diff, file and git request
  // (TASK-41), not just an attach. Without the kill a single stalled helper is
  // a request that never answers — and the throttle only stops the *next* one
  // starting for a few seconds, so the stalled processes pile up rather than
  // being replaced. Giving up reads as "could not tell", which every caller
  // already handles.
  private async runCapture(command: string[]): Promise<string> {
    let timer: Timer | null = null;
    try {
      const proc = Bun.spawn(command, { stdout: "pipe", stderr: "ignore" });
      timer = setTimeout(() => proc.kill(), LOOKUP_TIMEOUT_MS);
      // The kill ends both awaits: stdout hits EOF and exited resolves, so this
      // never outlives the child.
      const [output] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      return output;
    } catch {
      return "";
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // The terminal's foreground process group id (== its leader's pid). When no
  // program is running this equals the shell's own group, so callers fall back
  // to the shell cwd.
  private async getForegroundPid(shellPid: number): Promise<number | undefined> {
    const output = await this.runCapture(["ps", "-o", "tpgid=", "-p", String(shellPid)]);
    const tpgid = parseInt(output.trim(), 10);
    if (Number.isFinite(tpgid) && tpgid > 0) return tpgid;
    return undefined;
  }

  private async cwdForPid(pid: number): Promise<string | undefined> {
    if (process.platform === "darwin") {
      const output = await this.runCapture(["lsof", "-a", "-d", "cwd", "-Fn", "-p", String(pid)]);
      for (const line of output.split("\n")) {
        if (line.startsWith("n")) return line.slice(1);
      }
    } else {
      // No process at all on linux: /proc/<pid>/cwd is a symlink, and reading
      // it is a syscall. Spawning `readlink` to do it costs a fork and an exec
      // per lookup for an answer the kernel will hand over directly.
      try {
        const cwd = await readlink(`/proc/${pid}/cwd`);
        if (cwd) return cwd;
      } catch {
        // The process is gone, or /proc is not mounted. Either way: unknown.
      }
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

    // Smallest-wins strategy. Clients that haven't measured their terminal
    // yet (size === null) don't constrain the size; if no client has
    // measured, keep the current size.
    let cols = Infinity;
    let rows = Infinity;

    for (const client of this.clients.values()) {
      if (!client.size) continue;
      cols = Math.min(cols, client.size.cols);
      rows = Math.min(rows, client.size.rows);
    }

    if (cols === Infinity || rows === Infinity) {
      return;
    }

    // Only resize if changed
    if (cols !== this.size.cols || rows !== this.size.rows) {
      this.size = { cols, rows };
      this.terminal.resize(cols, rows);
      this.proc.terminal?.resize(cols, rows);

      // Notify all clients of the new size
      this.broadcast({ type: "resize", ptyId: this.id, cols, rows });
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
