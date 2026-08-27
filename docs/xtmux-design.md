# xtmux: Terminal Session Daemon

A design document for `xtmux`, a standalone terminal session daemon using `xterm-headless` that provides session persistence across Node API server restarts. This is designed to be integrated within the agent-os repository.

## Background

The original [xterm-headless-proxy.md](./xterm-headless-proxy.md) proposed replacing tmux with a Node-based solution using `@xterm/headless`. However, embedding the terminal manager within the API server means sessions are lost when the server restarts—problematic during development.

## Key Insight

tmux's value comes from being a **separate daemon** that owns the PTY processes. The tmux client can restart freely; sessions survive because the server holds them.

We apply the same principle: `xtmux` is a standalone daemon that owns PTY processes and xterm-headless instances. The Node API server (`server.ts`) becomes a thin proxy that can restart without affecting sessions.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       xtmux daemon                          │
│                    (stable, rarely restarts)                │
│                                                             │
│  ┌─────────────────┐    ┌─────────────────────────────────┐ │
│  │ SessionManager  │───►│ Session                         │ │
│  │                 │    │  ├─ PTY process (bash, etc.)    │ │
│  │  - create       │    │  ├─ xterm-headless (authority)  │ │
│  │  - attach       │    │  └─ connected clients           │ │
│  │  - route msgs   │    └─────────────────────────────────┘ │
│  └────────▲────────┘                                        │
│           │                                                 │
│  ┌────────┴────────┐                                        │
│  │  Unix Socket    │                                        │
│  │ ~/.xtmux/xtmux.sock                                      │
│  └────────▲────────┘                                        │
└───────────┼─────────────────────────────────────────────────┘
            │
   ┌────────┴────────┐
   │ Node API Server │  ◄── restarts frequently during dev
   │    (proxy)      │
   └────────▲────────┘
            │ WebSocket
   ┌────────┴────────┐
   │     Browser     │
   │   (xterm.js)    │
   └─────────────────┘
```

### Component Responsibilities

| Component | Responsibility |
|-----------|----------------|
| xtmux daemon | Owns PTYs, runs xterm-headless, handles multicast, serializes state for reconnection |
| Node API server | Proxies WebSocket connections to daemon, handles auth, routing |
| Browser | Renders terminal via xterm.js, sends input, receives output |

### Transport

- **Browser ↔ API Server**: WebSocket with JSON message protocol
- **API Server ↔ Daemon**: Unix socket with same JSON protocol (simple proxy)

Unix socket advantages:
- Fast (no TCP overhead)
- File-based permissions
- Clear daemon health check (socket file exists)
- Survives API server restarts naturally

## Protocol

Line-delimited JSON over Unix socket.

### Client → Daemon

```typescript
// Session management
{ "type": "create", "id": "session-1", "command": "/bin/bash", "args": [], "cols": 120, "rows": 40, "cwd": "/home/user", "env": { "FOO": "bar" } }
{ "type": "attach", "sessionId": "session-1", "cols": 120, "rows": 40 }
{ "type": "detach" }
{ "type": "kill", "sessionId": "session-1" }
{ "type": "list" }
{ "type": "rename", "sessionId": "old-id", "newId": "new-id" }

// Terminal interaction (when attached)
{ "type": "input", "data": "ls -la\r" }
{ "type": "resize", "cols": 100, "rows": 30 }

// Detached operations (no attach required)
{ "type": "send", "sessionId": "session-1", "data": "ls -la\r" }
{ "type": "capture", "sessionId": "session-1" }
{ "type": "capture", "sessionId": "session-1", "lines": 50 }
{ "type": "capture", "sessionId": "session-1", "scrollback": 500 }
{ "type": "getenv", "sessionId": "session-1", "variable": "CLAUDE_SESSION_ID" }
```

### Daemon → Client

```typescript
{ "type": "attached", "sessionId": "session-1" }
{ "type": "restore", "data": "<serialized terminal state>", "size": { "cols": 120, "rows": 40 } }
{ "type": "data", "data": "output from pty" }
{ "type": "resize", "cols": 100, "rows": 30 }
{ "type": "exit", "code": 0 }
{ "type": "error", "message": "Session not found" }
{ "type": "sessions", "list": [{ "id": "...", "command": "bash", "clientCount": 2, "size": {...}, "createdAt": 123, "lastActivity": 1699999999, "cwd": "/home/user/project" }] }
{ "type": "captured", "content": "terminal content here", "cwd": "/current/path" }
{ "type": "env", "variable": "CLAUDE_SESSION_ID", "value": "abc-123" }
{ "type": "renamed", "sessionId": "new-id" }
{ "type": "sent", "sessionId": "session-1" }
```

### SessionInfo Structure

```typescript
interface SessionInfo {
  id: string;
  command: string;
  clientCount: number;
  size: { cols: number; rows: number };
  createdAt: number;
  lastActivity: number;  // Unix timestamp of last PTY output
  cwd: string;           // Current working directory (tracked via OSC 7 or /proc)
}
```

### Message Reference

| Message | Direction | Description |
|---------|-----------|-------------|
| `create` | C→D | Create new session with command, cwd, size, optional env vars |
| `attach` | C→D | Attach to session, receive restore data and live output |
| `detach` | C→D | Detach from current session |
| `kill` | C→D | Kill a session |
| `list` | C→D | List all sessions with status info |
| `rename` | C→D | Rename a session ID |
| `input` | C→D | Send input to attached session |
| `resize` | C→D | Resize attached session |
| `send` | C→D | Send input to session without attaching |
| `capture` | C→D | Capture terminal content (screen or scrollback) |
| `getenv` | C→D | Get environment variable from session |
| `attached` | D→C | Confirm attachment |
| `restore` | D→C | Initial terminal state on attach |
| `data` | D→C | PTY output data |
| `resize` | D→C | Server-dictated resize |
| `exit` | D→C | Session process exited |
| `error` | D→C | Error response |
| `sessions` | D→C | List of sessions |
| `captured` | D→C | Captured terminal content |
| `env` | D→C | Environment variable value |
| `renamed` | D→C | Confirm rename |
| `sent` | D→C | Confirm send |

## Session Persistence

### What Survives API Server Restarts

Everything. The daemon holds all state:
- Running PTY processes
- Terminal screen buffer and scrollback
- Connected client list (API server reconnects)

### What Survives Daemon Restarts

**Partial recovery only.** When the daemon dies:
- PTY processes die (kernel constraint—cannot reconnect to orphaned PTY)
- Can checkpoint serialized terminal state to disk
- On restart: restore visual state, spawn fresh shell

```typescript
// Optional: periodic checkpointing for graceful daemon upgrades
const checkpoint = {
  id: session.id,
  serializedTerminal: session.serializeAddon.serialize(),
  size: session.size,
  cwd: session.cwd,
  checkpointedAt: Date.now(),
};
fs.writeFileSync(`~/.xtmux/checkpoints/${session.id}.json`, JSON.stringify(checkpoint));
```

This matches tmux behavior: if you kill the tmux server, sessions are lost.

## Screen Size Management

"Smallest wins" strategy when multiple clients connect with different sizes:

```typescript
const SIZE_FLOOR = { cols: 80, rows: 24 };

function recalculateSize(session: Session): void {
  if (session.clients.size === 0) return;

  let minCols = Infinity;
  let minRows = Infinity;

  for (const client of session.clients.values()) {
    minCols = Math.min(minCols, client.size.cols);
    minRows = Math.min(minRows, client.size.rows);
  }

  const cols = Math.max(SIZE_FLOOR.cols, minCols);
  const rows = Math.max(SIZE_FLOOR.rows, minRows);

  if (cols !== session.size.cols || rows !== session.size.rows) {
    session.size = { cols, rows };
    session.pty.resize(cols, rows);
    session.term.resize(cols, rows);
    broadcast(session, { type: "resize", cols, rows });
  }
}
```

## Implementation

xtmux is integrated within the agent-os repository rather than as a separate package. This keeps dependencies unified and simplifies development.

### Directory Structure

```
agent-os/
├── server.ts                    # Next.js server (updated to proxy to xtmux)
├── xtmux-daemon.ts              # xtmux daemon entry point (NEW)
├── lib/
│   ├── xtmux/                   # xtmux core code (NEW)
│   │   ├── index.ts             # Public exports for server.ts
│   │   ├── daemon.ts            # Daemon class
│   │   ├── session.ts           # Session (PTY + xterm-headless)
│   │   ├── session-manager.ts   # Manages all sessions
│   │   ├── client.ts            # Client connection handler
│   │   ├── protocol.ts          # Message types
│   │   ├── config.ts            # Paths configuration
│   │   └── cli.ts               # CLI command handlers
│   └── ...existing lib files
├── scripts/
│   ├── agent-os                 # Existing CLI (extended with xtmux subcommand)
│   └── lib/
│       └── xtmux.sh             # xtmux daemon management functions (NEW)
└── package.json                 # Updated with new deps and bin entry
```

### Integration Points

| File | Change |
|------|--------|
| `package.json` | Add `@xterm/headless`, `@xterm/addon-serialize` deps; add `xtmux` bin entry |
| `server.ts` | Replace direct PTY spawning with xtmux daemon proxy |
| `scripts/agent-os` | Add `xtmux` subcommand routing |
| `xtmux-daemon.ts` | New daemon entry point (parallel to `server.ts`) |
| `lib/xtmux/*` | New xtmux core implementation |

### package.json Changes

```json
{
  "bin": {
    "agent-os": "./scripts/agent-os",
    "xtmux": "./scripts/xtmux"
  },
  "scripts": {
    "dev": "tsx server.ts",
    "xtmux": "tsx xtmux-daemon.ts",
    "xtmux:start": "tsx xtmux-daemon.ts start",
    "xtmux:stop": "tsx xtmux-daemon.ts stop"
  },
  "dependencies": {
    "@xterm/headless": "^5.5.0",
    "@xterm/addon-serialize": "^0.13.0",
    // ... existing deps (node-pty ^1.2.0 already present)
  }
}
```

### lib/xtmux/config.ts

```typescript
import { join } from "path";
import { homedir } from "os";

const RUNTIME_DIR = process.env.XTMUX_RUNTIME_DIR ?? join(homedir(), ".agent-os", "xtmux");

export const config = {
  runtimeDir: RUNTIME_DIR,
  socketPath: process.env.XTMUX_SOCKET ?? join(RUNTIME_DIR, "xtmux.sock"),
  pidPath: join(RUNTIME_DIR, "xtmux.pid"),
  logPath: join(RUNTIME_DIR, "xtmux.log"),
};
```

### lib/xtmux/protocol.ts

```typescript
// Client -> Daemon
export type ClientMessage =
  // Session management
  | { type: "create"; id: string; command: string; args?: string[]; cols: number; rows: number; cwd?: string; env?: Record<string, string> }
  | { type: "attach"; sessionId: string; cols: number; rows: number }
  | { type: "detach" }
  | { type: "kill"; sessionId: string }
  | { type: "list" }
  | { type: "rename"; sessionId: string; newId: string }
  // Attached operations
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  // Detached operations (no attach required)
  | { type: "send"; sessionId: string; data: string }
  | { type: "capture"; sessionId: string; lines?: number; scrollback?: number }
  | { type: "getenv"; sessionId: string; variable: string };

// Daemon -> Client
export type DaemonMessage =
  | { type: "attached"; sessionId: string }
  | { type: "restore"; data: string; size: { cols: number; rows: number } }
  | { type: "data"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "exit"; code: number }
  | { type: "error"; message: string }
  | { type: "sessions"; list: SessionInfo[] }
  | { type: "captured"; content: string; cwd: string }
  | { type: "env"; variable: string; value: string | null }
  | { type: "renamed"; sessionId: string }
  | { type: "sent"; sessionId: string };

export interface SessionInfo {
  id: string;
  command: string;
  clientCount: number;
  size: { cols: number; rows: number };
  createdAt: number;
  lastActivity: number;  // Unix timestamp of last PTY output
  cwd: string;           // Current working directory
}

export function parse(line: string): ClientMessage {
  return JSON.parse(line);
}

export function serialize(msg: DaemonMessage): string {
  return JSON.stringify(msg) + "\n";
}
```

### lib/xtmux/session.ts

```typescript
import { Terminal } from "@xterm/headless";
import { SerializeAddon } from "@xterm/addon-serialize";
import * as pty from "node-pty";
import { Client } from "./client";
import { DaemonMessage, SessionInfo } from "./protocol";

const SIZE_FLOOR = { cols: 80, rows: 24 };

// OSC 7 pattern: \e]7;file://hostname/path\e\\ or \e]7;file://hostname/path\a
const OSC7_PATTERN = /\x1b\]7;file:\/\/[^\/]*([^\x07\x1b]*?)(?:\x07|\x1b\\)/g;

export class Session {
  readonly id: string;
  readonly command: string;
  readonly createdAt: number;

  private pty: pty.IPty;
  private term: Terminal;
  private serializeAddon: SerializeAddon;
  private clients = new Map<string, Client>();
  private size: { cols: number; rows: number };
  private onExit?: (code: number) => void;

  // New tracking fields
  private lastActivity: number;
  private cwd: string;
  private env: Record<string, string>;

  constructor(
    id: string,
    command: string,
    args: string[],
    options: { cols: number; rows: number; cwd?: string; env?: Record<string, string> }
  ) {
    this.id = id;
    this.command = command;
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this.size = { cols: options.cols, rows: options.rows };
    this.cwd = options.cwd ?? process.cwd();

    // Merge provided env with process env
    this.env = {
      ...process.env as Record<string, string>,
      ...options.env,
    };

    // Create PTY
    this.pty = pty.spawn(command, args, {
      name: "xterm-256color",
      cols: this.size.cols,
      rows: this.size.rows,
      cwd: this.cwd,
      env: this.env,
    });

    // Create headless terminal
    this.term = new Terminal({
      cols: this.size.cols,
      rows: this.size.rows,
      scrollback: 5000,
    });
    this.serializeAddon = new SerializeAddon();
    this.term.loadAddon(this.serializeAddon);

    // Route PTY output
    this.pty.onData((data) => {
      this.lastActivity = Date.now();
      this.term.write(data);
      this.broadcast({ type: "data", data });

      // Track cwd changes via OSC 7 escape sequences
      this.parseOsc7(data);
    });

    this.pty.onExit(({ exitCode }) => {
      this.broadcast({ type: "exit", code: exitCode });
      this.onExit?.(exitCode);
    });
  }

  // Parse OSC 7 sequences to track current working directory
  private parseOsc7(data: string): void {
    const matches = data.matchAll(OSC7_PATTERN);
    for (const match of matches) {
      if (match[1]) {
        try {
          this.cwd = decodeURIComponent(match[1]);
        } catch {
          // Invalid URI encoding, ignore
        }
      }
    }
  }

  setOnExit(handler: (code: number) => void): void {
    this.onExit = handler;
  }

  addClient(client: Client): void {
    this.clients.set(client.id, client);

    // Send current state
    client.send({
      type: "restore",
      data: this.serializeAddon.serialize(),
      size: this.size,
    });

    this.recalculateSize();
  }

  removeClient(clientId: string): void {
    this.clients.delete(clientId);
    this.recalculateSize();
  }

  write(data: string): void {
    this.pty.write(data);
  }

  updateClientSize(clientId: string, cols: number, rows: number): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.size = { cols, rows };
      this.recalculateSize();
    }
  }

  private recalculateSize(): void {
    if (this.clients.size === 0) return;

    let minCols = Infinity;
    let minRows = Infinity;

    for (const client of this.clients.values()) {
      if (client.size.cols > 0 && client.size.rows > 0) {
        minCols = Math.min(minCols, client.size.cols);
        minRows = Math.min(minRows, client.size.rows);
      }
    }

    const cols = Math.max(SIZE_FLOOR.cols, minCols);
    const rows = Math.max(SIZE_FLOOR.rows, minRows);

    if (cols !== this.size.cols || rows !== this.size.rows) {
      this.size = { cols, rows };
      this.pty.resize(cols, rows);
      this.term.resize(cols, rows);
      this.broadcast({ type: "resize", cols, rows });
    }
  }

  private broadcast(msg: DaemonMessage): void {
    for (const client of this.clients.values()) {
      client.send(msg);
    }
  }

  kill(): void {
    this.pty.kill();
    this.term.dispose();
  }

  // Capture terminal content (visible screen or with scrollback)
  capture(options?: { lines?: number; scrollback?: number }): string {
    const buffer = this.term.buffer.active;
    const lines: string[] = [];

    // Determine range to capture
    let startRow: number;
    let endRow: number;

    if (options?.scrollback) {
      // Capture from scrollback (negative offset from end)
      startRow = Math.max(0, buffer.length - options.scrollback);
      endRow = buffer.length;
    } else if (options?.lines) {
      // Capture last N lines of visible area
      startRow = Math.max(0, buffer.length - options.lines);
      endRow = buffer.length;
    } else {
      // Capture visible screen only
      startRow = buffer.baseY;
      endRow = buffer.baseY + this.term.rows;
    }

    for (let i = startRow; i < endRow; i++) {
      const line = buffer.getLine(i);
      if (line) {
        lines.push(line.translateToString(true));
      }
    }

    return lines.join("\n");
  }

  // Get environment variable value
  getEnv(variable: string): string | null {
    return this.env[variable] ?? null;
  }

  // Get current working directory
  getCwd(): string {
    return this.cwd;
  }

  // Get last activity timestamp
  getLastActivity(): number {
    return this.lastActivity;
  }

  getInfo(): SessionInfo {
    return {
      id: this.id,
      command: this.command,
      clientCount: this.clients.size,
      size: this.size,
      createdAt: this.createdAt,
      lastActivity: this.lastActivity,
      cwd: this.cwd,
    };
  }

  getClientCount(): number {
    return this.clients.size;
  }
}
```

### lib/xtmux/client.ts

```typescript
import { Socket } from "net";
import { ClientMessage, DaemonMessage, parse, serialize } from "./protocol";

export class Client {
  readonly id: string;
  size: { cols: number; rows: number };

  private socket: Socket;
  private buffer = "";
  private attachedSessionId: string | null = null;
  private onMessage?: (msg: ClientMessage) => void;
  private onDisconnect?: () => void;

  constructor(socket: Socket) {
    this.id = crypto.randomUUID();
    this.socket = socket;
    this.size = { cols: 80, rows: 24 };

    socket.on("data", (chunk) => this.handleData(chunk));
    socket.on("close", () => this.onDisconnect?.());
    socket.on("error", () => this.onDisconnect?.());
  }

  private handleData(chunk: Buffer): void {
    this.buffer += chunk.toString();

    // Line-delimited JSON
    let newlineIdx;
    while ((newlineIdx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newlineIdx);
      this.buffer = this.buffer.slice(newlineIdx + 1);

      if (line.trim()) {
        try {
          const msg = parse(line);
          this.onMessage?.(msg);
        } catch (e) {
          this.send({ type: "error", message: "Invalid JSON" });
        }
      }
    }
  }

  setOnMessage(handler: (msg: ClientMessage) => void): void {
    this.onMessage = handler;
  }

  setOnDisconnect(handler: () => void): void {
    this.onDisconnect = handler;
  }

  send(msg: DaemonMessage): void {
    if (!this.socket.destroyed) {
      this.socket.write(serialize(msg));
    }
  }

  setAttachedSession(sessionId: string | null): void {
    this.attachedSessionId = sessionId;
  }

  getAttachedSession(): string | null {
    return this.attachedSessionId;
  }

  close(): void {
    this.socket.end();
  }
}
```

### lib/xtmux/session-manager.ts

```typescript
import { Session } from "./session";
import { Client } from "./client";
import { ClientMessage, SessionInfo } from "./protocol";

export class SessionManager {
  private sessions = new Map<string, Session>();
  private clientSessionMap = new Map<string, string>(); // clientId -> sessionId

  handleClient(client: Client): void {
    client.setOnMessage((msg) => this.handleMessage(client, msg));
    client.setOnDisconnect(() => this.handleDisconnect(client));
  }

  private handleMessage(client: Client, msg: ClientMessage): void {
    switch (msg.type) {
      // Session management
      case "create":
        this.createSession(client, msg);
        break;

      case "attach":
        this.attachToSession(client, msg.sessionId, msg.cols, msg.rows);
        break;

      case "detach":
        this.detachClient(client);
        break;

      case "kill":
        this.killSession(client, msg.sessionId);
        break;

      case "list":
        client.send({ type: "sessions", list: this.listSessions() });
        break;

      case "rename":
        this.renameSession(client, msg.sessionId, msg.newId);
        break;

      // Attached operations
      case "input":
        this.forwardInput(client, msg.data);
        break;

      case "resize":
        this.handleResize(client, msg.cols, msg.rows);
        break;

      // Detached operations
      case "send":
        this.sendToSession(client, msg.sessionId, msg.data);
        break;

      case "capture":
        this.captureSession(client, msg.sessionId, msg.lines, msg.scrollback);
        break;

      case "getenv":
        this.getSessionEnv(client, msg.sessionId, msg.variable);
        break;
    }
  }

  private createSession(
    client: Client,
    msg: { id: string; command: string; args?: string[]; cols: number; rows: number; cwd?: string; env?: Record<string, string> }
  ): void {
    if (this.sessions.has(msg.id)) {
      client.send({ type: "error", message: `Session ${msg.id} already exists` });
      return;
    }

    const session = new Session(msg.id, msg.command, msg.args ?? [], {
      cols: msg.cols,
      rows: msg.rows,
      cwd: msg.cwd,
      env: msg.env,
    });

    session.setOnExit(() => {
      this.sessions.delete(msg.id);
    });

    this.sessions.set(msg.id, session);

    // Auto-attach creator
    this.attachToSession(client, msg.id, msg.cols, msg.rows);
  }

  private attachToSession(
    client: Client,
    sessionId: string,
    cols: number,
    rows: number
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      client.send({ type: "error", message: `Session ${sessionId} not found` });
      return;
    }

    // Detach from any current session first
    this.detachClient(client);

    client.size = { cols, rows };
    client.setAttachedSession(sessionId);
    this.clientSessionMap.set(client.id, sessionId);

    session.addClient(client);
    client.send({ type: "attached", sessionId });
  }

  private forwardInput(client: Client, data: string): void {
    const sessionId = client.getAttachedSession();
    if (!sessionId) {
      client.send({ type: "error", message: "Not attached to a session" });
      return;
    }

    const session = this.sessions.get(sessionId);
    session?.write(data);
  }

  private handleResize(client: Client, cols: number, rows: number): void {
    const sessionId = client.getAttachedSession();
    if (!sessionId) return;

    const session = this.sessions.get(sessionId);
    session?.updateClientSize(client.id, cols, rows);
  }

  private detachClient(client: Client): void {
    const sessionId = client.getAttachedSession();
    if (!sessionId) return;

    const session = this.sessions.get(sessionId);
    session?.removeClient(client.id);

    client.setAttachedSession(null);
    this.clientSessionMap.delete(client.id);
  }

  private handleDisconnect(client: Client): void {
    this.detachClient(client);
  }

  private killSession(client: Client, sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.kill();
      this.sessions.delete(sessionId);
    }
    // No confirmation needed - session is gone
  }

  private renameSession(client: Client, oldId: string, newId: string): void {
    if (this.sessions.has(newId)) {
      client.send({ type: "error", message: `Session ${newId} already exists` });
      return;
    }

    const session = this.sessions.get(oldId);
    if (!session) {
      client.send({ type: "error", message: `Session ${oldId} not found` });
      return;
    }

    // Move session to new ID
    this.sessions.delete(oldId);
    this.sessions.set(newId, session);

    // Update client mappings
    for (const [clientId, sessionId] of this.clientSessionMap) {
      if (sessionId === oldId) {
        this.clientSessionMap.set(clientId, newId);
      }
    }

    client.send({ type: "renamed", sessionId: newId });
  }

  // Detached operations - no attach required

  private sendToSession(client: Client, sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      client.send({ type: "error", message: `Session ${sessionId} not found` });
      return;
    }

    session.write(data);
    client.send({ type: "sent", sessionId });
  }

  private captureSession(
    client: Client,
    sessionId: string,
    lines?: number,
    scrollback?: number
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      client.send({ type: "error", message: `Session ${sessionId} not found` });
      return;
    }

    const content = session.capture({ lines, scrollback });
    client.send({
      type: "captured",
      content,
      cwd: session.getCwd(),
    });
  }

  private getSessionEnv(client: Client, sessionId: string, variable: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      client.send({ type: "error", message: `Session ${sessionId} not found` });
      return;
    }

    client.send({
      type: "env",
      variable,
      value: session.getEnv(variable),
    });
  }

  private listSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).map((s) => s.getInfo());
  }
}
```

### lib/xtmux/daemon.ts

```typescript
import { createServer, Server, Socket } from "net";
import { existsSync, unlinkSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { SessionManager } from "./session-manager";
import { Client } from "./client";
import { config } from "./config";

export class Daemon {
  private server: Server;
  private sessionManager: SessionManager;

  constructor() {
    this.sessionManager = new SessionManager();
    this.server = createServer((socket) => this.handleConnection(socket));
  }

  private handleConnection(socket: Socket): void {
    const client = new Client(socket);
    this.sessionManager.handleClient(client);
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Ensure runtime directory exists
      mkdirSync(dirname(config.socketPath), { recursive: true });

      // Clean up stale socket
      if (existsSync(config.socketPath)) {
        unlinkSync(config.socketPath);
      }

      this.server.on("error", reject);

      this.server.listen(config.socketPath, () => {
        // Write PID file
        writeFileSync(config.pidPath, process.pid.toString());

        console.log(`xtmux daemon started (pid: ${process.pid})`);
        console.log(`Listening on ${config.socketPath}`);
        resolve();
      });

      // Graceful shutdown handlers
      process.on("SIGTERM", () => this.shutdown());
      process.on("SIGINT", () => this.shutdown());
    });
  }

  private shutdown(): void {
    console.log("\nShutting down...");

    this.server.close();

    if (existsSync(config.socketPath)) {
      unlinkSync(config.socketPath);
    }
    if (existsSync(config.pidPath)) {
      unlinkSync(config.pidPath);
    }

    process.exit(0);
  }
}
```

### lib/xtmux/cli.ts (CLI Logic)

```typescript
import { connect } from "net";
import { spawn } from "child_process";
import { existsSync, readFileSync, openSync } from "fs";
import { config } from "./config";
import { Daemon } from "./daemon";
import { ClientMessage, DaemonMessage } from "./protocol";

const [, , command, ...args] = process.argv;

// ============================================================
// Daemon Management
// ============================================================

function isDaemonRunning(): boolean {
  if (!existsSync(config.pidPath)) return false;

  const pid = parseInt(readFileSync(config.pidPath, "utf-8").trim());

  try {
    // Signal 0 tests if process exists
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getDaemonPid(): number | null {
  if (!existsSync(config.pidPath)) return null;
  return parseInt(readFileSync(config.pidPath, "utf-8").trim());
}

async function startDaemon(foreground: boolean): Promise<void> {
  if (isDaemonRunning()) {
    console.log("Daemon is already running (pid: " + getDaemonPid() + ")");
    process.exit(0);
  }

  if (foreground) {
    // Run in foreground
    const daemon = new Daemon();
    await daemon.start();
    // Keep process alive
  } else {
    // Spawn detached background process
    const logFd = openSync(config.logPath, "a");

    const child = spawn(process.execPath, [__filename, "start", "--foreground"], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });

    child.unref();

    // Wait briefly and verify it started
    await sleep(500);

    if (isDaemonRunning()) {
      console.log(`Daemon started (pid: ${getDaemonPid()})`);
      console.log(`Logs: ${config.logPath}`);
    } else {
      console.error("Failed to start daemon. Check logs:", config.logPath);
      process.exit(1);
    }
  }
}

function stopDaemon(): void {
  if (!isDaemonRunning()) {
    console.log("Daemon is not running");
    process.exit(0);
  }

  const pid = getDaemonPid()!;

  try {
    process.kill(pid, "SIGTERM");
    console.log(`Stopped daemon (pid: ${pid})`);
  } catch (e) {
    console.error(`Failed to stop daemon: ${e}`);
    process.exit(1);
  }
}

function showStatus(): void {
  if (isDaemonRunning()) {
    console.log(`Daemon is running (pid: ${getDaemonPid()})`);
    console.log(`Socket: ${config.socketPath}`);
  } else {
    console.log("Daemon is not running");
  }
}

// ============================================================
// Session Commands
// ============================================================

function requireDaemon(): void {
  if (!isDaemonRunning()) {
    console.error("Daemon is not running. Start it with: xtmux start");
    process.exit(1);
  }
}

function sendCommand(msg: ClientMessage): Promise<DaemonMessage> {
  return new Promise((resolve, reject) => {
    const socket = connect(config.socketPath);
    let buffer = "";

    socket.on("connect", () => {
      socket.write(JSON.stringify(msg) + "\n");
    });

    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const newlineIdx = buffer.indexOf("\n");
      if (newlineIdx !== -1) {
        const line = buffer.slice(0, newlineIdx);
        socket.end();
        resolve(JSON.parse(line));
      }
    });

    socket.on("error", reject);
  });
}

async function listSessions(): Promise<void> {
  requireDaemon();

  const response = await sendCommand({ type: "list" });

  if (response.type !== "sessions") {
    console.error("Unexpected response:", response);
    process.exit(1);
  }

  const { list } = response;

  if (list.length === 0) {
    console.log("No active sessions");
  } else {
    console.log("ID                                   COMMAND    CLIENTS  SIZE");
    console.log("─".repeat(65));
    for (const s of list) {
      const id = s.id.padEnd(36);
      const cmd = s.command.padEnd(10);
      const clients = String(s.clientCount).padEnd(8);
      const size = `${s.size.cols}x${s.size.rows}`;
      console.log(`${id} ${cmd} ${clients} ${size}`);
    }
  }
}

async function killSession(sessionId: string): Promise<void> {
  requireDaemon();

  const response = await sendCommand({ type: "kill", sessionId });

  if (response.type === "error") {
    console.error(`Error: ${response.message}`);
    process.exit(1);
  }

  console.log(`Killed session: ${sessionId}`);
}

async function interactiveAttach(sessionId: string): Promise<void> {
  requireDaemon();

  const socket = connect(config.socketPath);

  // Set terminal to raw mode
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();

  socket.on("connect", () => {
    socket.write(JSON.stringify({
      type: "attach",
      sessionId,
      cols: process.stdout.columns ?? 80,
      rows: process.stdout.rows ?? 24,
    }) + "\n");
  });

  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk.toString();

    let newlineIdx;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);

      if (!line.trim()) continue;

      const msg: DaemonMessage = JSON.parse(line);

      switch (msg.type) {
        case "restore":
        case "data":
          process.stdout.write(msg.data);
          break;
        case "resize":
          // Server dictated resize
          break;
        case "exit":
          console.log(`\n[Session exited with code ${msg.code}]`);
          cleanup();
          process.exit(msg.code);
          break;
        case "error":
          console.error(`\nError: ${msg.message}`);
          cleanup();
          process.exit(1);
          break;
      }
    }
  });

  // Forward input to daemon
  process.stdin.on("data", (data) => {
    socket.write(JSON.stringify({ type: "input", data: data.toString() }) + "\n");
  });

  // Handle terminal resize
  process.stdout.on("resize", () => {
    socket.write(JSON.stringify({
      type: "resize",
      cols: process.stdout.columns,
      rows: process.stdout.rows,
    }) + "\n");
  });

  socket.on("close", () => {
    console.log("\n[Connection closed]");
    cleanup();
    process.exit(0);
  });

  socket.on("error", (err) => {
    console.error("\nConnection error:", err.message);
    cleanup();
    process.exit(1);
  });

  function cleanup(): void {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
  }
}

async function createSession(sessionId: string, cmd?: string): Promise<void> {
  requireDaemon();

  const command = cmd ?? process.env.SHELL ?? "/bin/bash";
  const id = sessionId || crypto.randomUUID();

  const socket = connect(config.socketPath);

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();

  socket.on("connect", () => {
    socket.write(JSON.stringify({
      type: "create",
      id,
      command,
      args: [],
      cols: process.stdout.columns ?? 80,
      rows: process.stdout.rows ?? 24,
      cwd: process.cwd(),
    }) + "\n");
  });

  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk.toString();

    let newlineIdx;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);

      if (!line.trim()) continue;

      const msg: DaemonMessage = JSON.parse(line);

      switch (msg.type) {
        case "attached":
          break;
        case "restore":
        case "data":
          process.stdout.write(msg.data);
          break;
        case "exit":
          console.log(`\n[Session exited with code ${msg.code}]`);
          cleanup();
          process.exit(msg.code);
          break;
        case "error":
          console.error(`Error: ${msg.message}`);
          cleanup();
          process.exit(1);
          break;
      }
    }
  });

  process.stdin.on("data", (data) => {
    socket.write(JSON.stringify({ type: "input", data: data.toString() }) + "\n");
  });

  process.stdout.on("resize", () => {
    socket.write(JSON.stringify({
      type: "resize",
      cols: process.stdout.columns,
      rows: process.stdout.rows,
    }) + "\n");
  });

  function cleanup(): void {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
  }
}

// ============================================================
// Utilities
// ============================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureSession(sessionId: string, lines?: number, scrollback?: number): Promise<void> {
  requireDaemon();

  const response = await sendCommand({
    type: "capture",
    sessionId,
    lines,
    scrollback,
  });

  if (response.type === "error") {
    console.error(`Error: ${response.message}`);
    process.exit(1);
  }

  if (response.type === "captured") {
    console.log(response.content);
  }
}

async function sendToSession(sessionId: string, data: string): Promise<void> {
  requireDaemon();

  const response = await sendCommand({
    type: "send",
    sessionId,
    data,
  });

  if (response.type === "error") {
    console.error(`Error: ${response.message}`);
    process.exit(1);
  }

  console.log(`Sent to session: ${sessionId}`);
}

async function renameSession(oldId: string, newId: string): Promise<void> {
  requireDaemon();

  const response = await sendCommand({
    type: "rename",
    sessionId: oldId,
    newId,
  });

  if (response.type === "error") {
    console.error(`Error: ${response.message}`);
    process.exit(1);
  }

  console.log(`Renamed session: ${oldId} -> ${newId}`);
}

async function getSessionEnv(sessionId: string, variable: string): Promise<void> {
  requireDaemon();

  const response = await sendCommand({
    type: "getenv",
    sessionId,
    variable,
  });

  if (response.type === "error") {
    console.error(`Error: ${response.message}`);
    process.exit(1);
  }

  if (response.type === "env") {
    if (response.value !== null) {
      console.log(response.value);
    } else {
      console.error(`Variable ${variable} not set`);
      process.exit(1);
    }
  }
}

function printHelp(): void {
  console.log(`
xtmux - Terminal session manager

Usage: xtmux <command> [options]

Daemon Commands:
  start                Start the daemon (background)
  start --foreground   Start the daemon in foreground
  stop                 Stop the daemon
  status               Show daemon status

Session Commands:
  list                 List all sessions
  new [id] [command]   Create a new session and attach
  attach <id>          Attach to an existing session
  kill <id>            Kill a session
  rename <old> <new>   Rename a session

Detached Operations (no attach required):
  send <id> <text>     Send input to a session
  capture <id>         Capture visible screen content
  capture <id> -n 50   Capture last 50 lines
  capture <id> -s 500  Capture with 500 lines of scrollback
  getenv <id> <var>    Get environment variable from session

Examples:
  xtmux start          # Start daemon in background
  xtmux new            # Create session with default shell
  xtmux new mysession  # Create named session
  xtmux new work node  # Create session running node
  xtmux attach work    # Reattach to session
  xtmux list           # Show all sessions
  xtmux kill work      # Kill a session
  xtmux stop           # Stop daemon (kills all sessions)
  xtmux send work "ls -la"  # Send command to session
  xtmux capture work   # Get current screen content
  xtmux capture work -s 100  # Get last 100 lines with scrollback

Environment:
  XTMUX_RUNTIME_DIR    Runtime directory (default: ~/.agent-os/xtmux)
  XTMUX_SOCKET         Socket path (default: ~/.agent-os/xtmux/xtmux.sock)
`);
}

// ============================================================
// Main
// ============================================================

async function main(): Promise<void> {
  switch (command) {
    case "start":
      const foreground = args.includes("--foreground") || args.includes("-f");
      await startDaemon(foreground);
      break;

    case "stop":
      stopDaemon();
      break;

    case "status":
      showStatus();
      break;

    case "list":
    case "ls":
      await listSessions();
      break;

    case "new":
    case "create":
      await createSession(args[0], args[1]);
      break;

    case "attach":
    case "a":
      if (!args[0]) {
        console.error("Usage: xtmux attach <session-id>");
        process.exit(1);
      }
      await interactiveAttach(args[0]);
      break;

    case "kill":
      if (!args[0]) {
        console.error("Usage: xtmux kill <session-id>");
        process.exit(1);
      }
      await killSession(args[0]);
      break;

    case "rename":
      if (!args[0] || !args[1]) {
        console.error("Usage: xtmux rename <old-id> <new-id>");
        process.exit(1);
      }
      await renameSession(args[0], args[1]);
      break;

    case "send":
      if (!args[0] || !args[1]) {
        console.error("Usage: xtmux send <session-id> <text>");
        process.exit(1);
      }
      await sendToSession(args[0], args.slice(1).join(" "));
      break;

    case "capture":
      if (!args[0]) {
        console.error("Usage: xtmux capture <session-id> [-n lines] [-s scrollback]");
        process.exit(1);
      }
      const linesIdx = args.indexOf("-n");
      const scrollbackIdx = args.indexOf("-s");
      const lines = linesIdx !== -1 ? parseInt(args[linesIdx + 1]) : undefined;
      const scrollback = scrollbackIdx !== -1 ? parseInt(args[scrollbackIdx + 1]) : undefined;
      await captureSession(args[0], lines, scrollback);
      break;

    case "getenv":
      if (!args[0] || !args[1]) {
        console.error("Usage: xtmux getenv <session-id> <variable>");
        process.exit(1);
      }
      await getSessionEnv(args[0], args[1]);
      break;

    case "help":
    case "--help":
    case "-h":
    case undefined:
      printHelp();
      break;

    default:
      console.error(`Unknown command: ${command}`);
      console.error("Run 'xtmux help' for usage");
      process.exit(1);
  }
}

// Export the main function for use by xtmux-daemon.ts
export async function cli(argv: string[]): Promise<void> {
  const [command, ...args] = argv;
  // ... same switch logic as main() above
  await main();
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
```

### lib/xtmux/index.ts (Public Exports)

```typescript
// Public exports for use by server.ts and other parts of agent-os
export { config } from "./config";
export { Daemon } from "./daemon";
export { Session } from "./session";
export { SessionManager } from "./session-manager";
export { Client } from "./client";
export * from "./protocol";
export { cli } from "./cli";
```

### xtmux-daemon.ts (Root Entry Point)

This file lives at the root of the repo, parallel to `server.ts`:

```typescript
#!/usr/bin/env tsx
/**
 * xtmux daemon entry point
 * Run with: tsx xtmux-daemon.ts [command]
 *
 * This is the standalone daemon process that manages terminal sessions.
 * It runs independently of the Next.js server (server.ts).
 */
import { cli } from "./lib/xtmux/cli";

cli(process.argv.slice(2));
```

### scripts/xtmux (CLI Wrapper)

Bash wrapper for npm bin:

```bash
#!/usr/bin/env bash
# xtmux CLI wrapper
# Calls the TypeScript daemon entry point

set -euo pipefail

SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

exec npx tsx "$REPO_DIR/xtmux-daemon.ts" "$@"
```

### scripts/agent-os Changes

Add xtmux subcommand to existing CLI:

```bash
# In scripts/agent-os, add to the case statement:
case "${1:-}" in
    # ... existing commands ...
    xtmux)
        shift
        exec npx tsx "$LOCAL_REPO/xtmux-daemon.ts" "$@"
        ;;
esac
```

## CLI Usage

Two ways to invoke xtmux commands:

```bash
# Option 1: Direct xtmux command
$ xtmux start
$ xtmux new mysession
$ xtmux list

# Option 2: As agent-os subcommand
$ agent-os xtmux start
$ agent-os xtmux new mysession
$ agent-os xtmux list

# Option 3: npm scripts (during development)
$ npm run xtmux -- start
$ npm run xtmux -- new mysession
```

### Full Command Reference

```bash
# Start daemon in background
$ xtmux start
Daemon started (pid: 12345)
Logs: ~/.agent-os/xtmux/xtmux.log

# Check daemon status
$ xtmux status
Daemon is running (pid: 12345)
Socket: ~/.agent-os/xtmux/xtmux.sock

# Create and attach to new session
$ xtmux new
# ... interactive shell, Ctrl+D or exit to leave ...

# Create named session with specific command
$ xtmux new dev-server "npm run dev"

# List all sessions (includes lastActivity and cwd)
$ xtmux list
ID                                   COMMAND    CLIENTS  SIZE      LAST ACTIVITY  CWD
───────────────────────────────────────────────────────────────────────────────────────
a1b2c3d4-e5f6-...                    bash       0        120x40    2s ago         /home/user
dev-server                           npm        1        80x24     5m ago         /home/user/project

# Reattach to existing session
$ xtmux attach dev-server

# Kill a session
$ xtmux kill dev-server

# Rename a session
$ xtmux rename dev-server production

# Stop daemon (kills all sessions)
$ xtmux stop
Stopped daemon (pid: 12345)

# --- Detached Operations (no attach required) ---

# Send input to a session without attaching
$ xtmux send dev-server "npm run build"
Sent to session: dev-server

# Capture current visible screen
$ xtmux capture dev-server

# Capture last 50 lines
$ xtmux capture dev-server -n 50

# Capture with 500 lines of scrollback
$ xtmux capture dev-server -s 500

# Get environment variable from session
$ xtmux getenv dev-server CLAUDE_SESSION_ID
abc-123-def-456
```

### Development Workflow

```bash
# Terminal 1: Start xtmux daemon (sessions persist here)
npm run xtmux -- start --foreground

# Terminal 2: Start Next.js dev server (can restart freely)
npm run dev

# Restart Next.js as needed - terminal sessions survive!
# Ctrl+C in Terminal 2, then npm run dev again
```

## server.ts Integration

The existing `server.ts` is updated to proxy terminal WebSocket connections to the xtmux daemon instead of spawning PTYs directly.

### Before (Current Implementation)

```typescript
// server.ts - spawns PTY directly (sessions lost on restart)
terminalWss.on("connection", (ws: WebSocket) => {
  const ptyProcess = pty.spawn(shell, [], { ... });

  ptyProcess.onData((data) => {
    ws.send(JSON.stringify({ type: "output", data }));
  });

  ws.on("message", (message) => {
    const msg = JSON.parse(message.toString());
    if (msg.type === "input") ptyProcess.write(msg.data);
  });
});
```

### After (Proxying to xtmux)

```typescript
// server.ts - proxies to xtmux daemon (sessions survive restarts)
import { connect } from "net";
import { config } from "./lib/xtmux";

terminalWss.on("connection", (ws: WebSocket, request) => {
  const { pathname, query } = parse(request.url || "", true);
  const sessionId = query.sessionId as string;
  const cols = parseInt(query.cols as string) || 80;
  const rows = parseInt(query.rows as string) || 24;

  // Connect to xtmux daemon
  const daemonSocket = connect(config.socketPath);

  daemonSocket.on("error", (err) => {
    ws.send(JSON.stringify({
      type: "error",
      message: "xtmux daemon not running. Start with: xtmux start"
    }));
    ws.close();
  });

  daemonSocket.on("connect", () => {
    // Attach to or create session
    daemonSocket.write(JSON.stringify({
      type: sessionId ? "attach" : "create",
      sessionId: sessionId || crypto.randomUUID(),
      id: sessionId || crypto.randomUUID(),
      command: process.env.SHELL || "/bin/bash",
      args: [],
      cols,
      rows,
      cwd: process.env.HOME,
    }) + "\n");
  });

  // Proxy daemon -> browser
  let buffer = "";
  daemonSocket.on("data", (chunk) => {
    buffer += chunk.toString();
    let idx;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (line.trim() && ws.readyState === WebSocket.OPEN) {
        // Transform xtmux message format to existing frontend format
        const msg = JSON.parse(line);
        if (msg.type === "data") {
          ws.send(JSON.stringify({ type: "output", data: msg.data }));
        } else if (msg.type === "restore") {
          ws.send(JSON.stringify({ type: "output", data: msg.data }));
        } else {
          ws.send(line);
        }
      }
    }
  });

  // Proxy browser -> daemon
  ws.on("message", (message: Buffer) => {
    const msg = JSON.parse(message.toString());
    if (msg.type === "input" || msg.type === "command") {
      const data = msg.type === "command" ? msg.data + "\r" : msg.data;
      daemonSocket.write(JSON.stringify({ type: "input", data }) + "\n");
    } else if (msg.type === "resize") {
      daemonSocket.write(JSON.stringify({
        type: "resize",
        cols: msg.cols,
        rows: msg.rows
      }) + "\n");
    }
  });

  ws.on("close", () => {
    daemonSocket.write(JSON.stringify({ type: "detach" }) + "\n");
    daemonSocket.end();
  });

  daemonSocket.on("close", () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });
});
```

## Comparison to tmux

| Aspect | tmux | xtmux |
|--------|------|-------|
| Architecture | Client-server via socket | Client-server via socket |
| Process owner | tmux server | xtmux daemon |
| State storage | tmux server memory | xterm-headless in daemon |
| Client restarts | Sessions survive | Sessions survive |
| Server restarts | Sessions lost | Sessions lost |
| Direct buffer access | `tmux capture-pane` (shell out) | Direct API |
| Input handling | Shell escaping for `send-keys` | Direct `pty.write()` |
| Multi-client | Built-in | Built-in |
| External dependency | Required | None (Node-native) |
| Manual debugging | `tmux attach` | `xtmux attach` |

## Future Considerations

- **Scrollback persistence**: Serialize terminal state to disk periodically for crash recovery
- **Session groups**: Group related sessions together
- **Read-only clients**: Viewers who can see but not input
- **Recording/playback**: Store PTY output stream for session replay
- **Remote daemon**: TCP socket option for remote access (with auth)
- **Auto-start**: Automatically start xtmux daemon when `agent-os start` runs
- **Status integration**: Show xtmux session status in agent-os UI
- **Session naming**: Better integration with agent-os session management

## Summary

xtmux provides session persistence for agent-os terminals by separating the PTY-owning daemon from the Next.js server. Key points:

1. **Daemon independence**: xtmux daemon runs separately from server.ts
2. **Session survival**: Terminal sessions persist across server.ts restarts
3. **Integrated codebase**: Lives in `lib/xtmux/` within agent-os repo
4. **Unified CLI**: Available as `xtmux` command or `agent-os xtmux` subcommand
5. **Same dependencies**: Uses existing node-pty, adds xterm-headless
6. **Minimal frontend changes**: server.ts becomes a proxy; browser code unchanged
