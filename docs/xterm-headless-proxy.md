# xterm-headless Proxy: Node-based Shell Session Manager

A design document for building a Node.js-based shell session manager using `xterm-headless` that supports multicasting to multiple `xterm.js` browser instances. This replaces tmux as the session persistence and multiplexing layer.

## Motivation

The current AgentOS architecture uses tmux for:

1. **Session persistence** - Agent processes survive browser disconnects
2. **Multi-client access** - Multiple browsers can view the same session
3. **Terminal state restoration** - New clients can "reattach" and see current screen state

The key insight is that tmux's real value is being a **stateful terminal proxy** - it maintains terminal screen state (buffers, cursor, attributes) and redraws it for new attachments. Process persistence is almost a side effect.

A Node-based implementation can provide the same capabilities with benefits:

- No external dependency (tmux)
- Direct buffer access for status detection (no `tmux capture-pane`)
- Simpler input handling (no shell escaping for `tmux send-keys`)
- Single runtime for easier debugging

## Architecture Overview

```
                                      ┌─────────────┐
                                  ┌──►│ xterm.js A  │ (Browser A)
                                  │   └─────────────┘
┌─────┐    ┌───────────────┐      │   ┌─────────────┐
│ PTY │───►│xterm-headless │──────┼──►│ xterm.js B  │ (Browser B)
└─────┘    │  (authority)  │      │   └─────────────┘
           └───────────────┘      │   ┌─────────────┐
                  │               └──►│ xterm.js C  │ (Browser C)
                  │                   └─────────────┘
                  ▼
           ┌─────────────┐
           │ Serialized  │  (for reconnection)
           │   State     │
           └─────────────┘
```

All connected clients receive the same byte stream from the PTY. The server-side `xterm-headless` instance is the authoritative source of terminal state.

## Core Data Structures

```typescript
import { Terminal } from "@xterm/headless";
import { SerializeAddon } from "@xterm/addon-serialize";
import type { IPty } from "node-pty";

interface Session {
  id: string;
  pty: IPty;
  term: Terminal;              // xterm-headless instance
  serializeAddon: SerializeAddon;
  clients: Map<string, ClientInfo>;
  size: { cols: number; rows: number };
  createdAt: number;
}

interface ClientInfo {
  id: string;
  ws: WebSocket;
  size: { cols: number; rows: number };
  isActive: boolean;           // For aggressive resize mode
  connectedAt: number;
}

const sessions = new Map<string, Session>();
```

## Session Lifecycle

### Creating a Session

```typescript
import { Terminal } from "@xterm/headless";
import { SerializeAddon } from "@xterm/addon-serialize";
import * as pty from "node-pty";

function createSession(
  id: string,
  command: string,
  args: string[],
  options?: { cols?: number; rows?: number; cwd?: string }
): Session {
  const cols = options?.cols ?? 80;
  const rows = options?.rows ?? 24;

  // Create PTY process
  const ptyProcess = pty.spawn(command, args, {
    name: "xterm-256color",
    cols,
    rows,
    cwd: options?.cwd ?? process.cwd(),
    env: process.env as Record<string, string>,
  });

  // Create headless terminal (authoritative state)
  const term = new Terminal({ cols, rows });
  const serializeAddon = new SerializeAddon();
  term.loadAddon(serializeAddon);

  const session: Session = {
    id,
    pty: ptyProcess,
    term,
    serializeAddon,
    clients: new Map(),
    size: { cols, rows },
    createdAt: Date.now(),
  };

  // Route PTY output to headless terminal + all clients
  ptyProcess.onData((data) => {
    term.write(data);
    broadcastToClients(session, { type: "data", data });
  });

  // Handle PTY exit
  ptyProcess.onExit(({ exitCode }) => {
    broadcastToClients(session, { type: "exit", code: exitCode });
    cleanupSession(id);
  });

  sessions.set(id, session);
  return session;
}

function broadcastToClients(
  session: Session,
  message: object
): void {
  const payload = JSON.stringify(message);
  for (const client of session.clients.values()) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}
```

### Attaching a Client

When a browser connects to an existing session:

```typescript
function attachClient(
  sessionId: string,
  ws: WebSocket,
  clientSize: { cols: number; rows: number }
): void {
  const session = sessions.get(sessionId);
  if (!session) {
    ws.send(JSON.stringify({ type: "error", message: "Session not found" }));
    ws.close();
    return;
  }

  const clientId = crypto.randomUUID();
  const client: ClientInfo = {
    id: clientId,
    ws,
    size: clientSize,
    isActive: true,
    connectedAt: Date.now(),
  };

  session.clients.set(clientId, client);

  // Send current terminal state (serialized)
  const serializedState = session.serializeAddon.serialize();
  ws.send(JSON.stringify({
    type: "restore",
    data: serializedState,
    size: session.size,
  }));

  // Recalculate session size with new client
  recalculateSize(session);

  // Handle incoming messages from client
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    handleClientMessage(session, clientId, msg);
  });

  // Handle disconnect
  ws.on("close", () => {
    session.clients.delete(clientId);
    recalculateSize(session);  // May resize if smallest client left
  });
}

function handleClientMessage(
  session: Session,
  clientId: string,
  msg: { type: string; data?: string; cols?: number; rows?: number }
): void {
  switch (msg.type) {
    case "input":
      // Write directly to PTY (no shell escaping needed)
      session.pty.write(msg.data);
      break;

    case "resize":
      const client = session.clients.get(clientId);
      if (client && msg.cols && msg.rows) {
        client.size = { cols: msg.cols, rows: msg.rows };
        recalculateSize(session);
      }
      break;
  }
}
```

### Killing a Session

```typescript
function killSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;

  // Close all client connections
  for (const client of session.clients.values()) {
    client.ws.close();
  }

  // Kill the PTY process
  session.pty.kill();

  // Dispose headless terminal
  session.term.dispose();

  sessions.delete(sessionId);
}
```

## Screen Size Management

### Smallest Wins Strategy

When multiple clients with different screen sizes connect, use the smallest dimensions so all clients see identical content:

```typescript
const SIZE_FLOOR = { cols: 80, rows: 24 };  // Never go smaller than this

function recalculateSize(session: Session): void {
  if (session.clients.size === 0) return;

  // Find minimum dimensions across all active clients
  let minCols = Infinity;
  let minRows = Infinity;

  for (const client of session.clients.values()) {
    if (client.size.cols > 0 && client.size.rows > 0) {
      minCols = Math.min(minCols, client.size.cols);
      minRows = Math.min(minRows, client.size.rows);
    }
  }

  // Apply floor
  const cols = Math.max(SIZE_FLOOR.cols, minCols);
  const rows = Math.max(SIZE_FLOOR.rows, minRows);

  // Only resize if changed
  if (cols !== session.size.cols || rows !== session.size.rows) {
    session.size = { cols, rows };

    // Resize PTY (sends SIGWINCH to process)
    session.pty.resize(cols, rows);

    // Resize headless terminal
    session.term.resize(cols, rows);

    // Notify all clients of new authoritative size
    broadcastToClients(session, { type: "resize", cols, rows });
  }
}
```

### Client-Side Resize Handling

```typescript
// Browser client
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  switch (msg.type) {
    case "resize":
      // Server dictates size - client adapts
      term.resize(msg.cols, msg.rows);
      break;

    case "restore":
      // Initial state restoration on connect
      term.resize(msg.size.cols, msg.size.rows);
      term.write(msg.data);
      break;

    case "data":
      term.write(msg.data);
      break;
  }
};
```

### Alternative: Aggressive Resize

Only count active/focused clients for size calculation:

```typescript
function recalculateSize(session: Session): void {
  const activeClients = [...session.clients.values()]
    .filter(c => c.isActive && c.size.cols > 0);

  if (activeClients.length === 0) return;  // Keep current size

  // ... rest of smallest-wins logic using activeClients
}
```

## State Drift Mitigation

### Why Drift Could Happen

| Cause | Risk Level | Notes |
|-------|------------|-------|
| Version mismatch | Low | Use same xterm.js version on server/client |
| Network packet loss | Medium | WebSocket is reliable, but disconnects happen |
| Processing bugs | Low | Same codebase, same input = same output |
| Race during reconnect | Medium | Client gets snapshot + may miss buffered data |

### Why Drift is Unlikely

All instances process the identical byte stream. xterm.js is deterministic - same input produces same state. The serialize/restore is only used once at reconnection, then it's back to the shared stream.

### Reconnection Window Handling

```
Timeline:
─────────────────────────────────────────────────────────►
     │                    │                │
     ▼                    ▼                ▼
  Client               Client          Client receives
  disconnects          reconnects      serialized state

     ├──────────────────┤
     PTY output during this window
     is captured by xterm-headless
```

Because the headless terminal continuously processes PTY output, the serialized state at reconnection time already includes everything that happened while the client was disconnected. No explicit buffering needed.

### Optional: Integrity Verification

```typescript
import { createHash } from "crypto";

function hashTerminalState(term: Terminal): string {
  const buffer = term.buffer.active;
  let content = "";
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (line) content += line.translateToString(true) + "\n";
  }
  return createHash("md5").update(content).digest("hex");
}

// Periodic integrity check (optional paranoia mode)
setInterval(() => {
  for (const session of sessions.values()) {
    const serverHash = hashTerminalState(session.term);
    broadcastToClients(session, { type: "checksum", hash: serverHash });
  }
}, 30000);

// Client requests re-sync if checksum mismatches
```

## Terminal State Components

What the headless terminal maintains (and can serialize):

| State | Description |
|-------|-------------|
| Main screen buffer | Normal scrollable content (scrollback + visible) |
| Alternate screen buffer | Full-screen apps (vim, less, htop) use this |
| Cursor position | X, Y coordinates |
| Text attributes | Colors, bold, underline at each cell |
| Terminal modes | Application cursor keys, bracketed paste, etc. |
| Scrollback | Configurable history buffer |

## Direct Buffer Access

One advantage over tmux: direct access to terminal state for status detection without shelling out:

```typescript
function getTerminalContent(session: Session, lastNLines?: number): string {
  const buffer = session.term.buffer.active;
  const lines: string[] = [];

  const startRow = lastNLines
    ? Math.max(0, buffer.length - lastNLines)
    : 0;

  for (let i = startRow; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (line) {
      lines.push(line.translateToString(true));
    }
  }

  return lines.join("\n");
}

// Use for status detection
function detectSessionStatus(session: Session): "running" | "waiting" | "idle" {
  const content = getTerminalContent(session, 10);

  if (content.includes("esc to interrupt")) return "running";
  if (/\[Y\/n\]/i.test(content)) return "waiting";
  return "idle";
}
```

## WebSocket Server Setup

```typescript
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { parse } from "url";

const server = createServer();
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const { pathname, query } = parse(request.url || "", true);

  // Route: /ws/session/:sessionId
  const match = pathname?.match(/^\/ws\/session\/(.+)$/);
  if (match) {
    const sessionId = match[1];

    wss.handleUpgrade(request, socket, head, (ws) => {
      // Client sends initial size in query or first message
      const cols = parseInt(query.cols as string) || 80;
      const rows = parseInt(query.rows as string) || 24;

      attachClient(sessionId, ws, { cols, rows });
    });
  } else {
    socket.destroy();
  }
});

server.listen(3000);
```

## Client-Side Implementation

```typescript
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

const term = new Terminal();
const fitAddon = new FitAddon();
term.loadAddon(fitAddon);
term.open(document.getElementById("terminal")!);
fitAddon.fit();

const ws = new WebSocket(
  `ws://localhost:3000/ws/session/${sessionId}?cols=${term.cols}&rows=${term.rows}`
);

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  switch (msg.type) {
    case "restore":
      term.reset();
      term.resize(msg.size.cols, msg.size.rows);
      term.write(msg.data);
      break;

    case "data":
      term.write(msg.data);
      break;

    case "resize":
      term.resize(msg.cols, msg.rows);
      break;

    case "exit":
      console.log("Session exited with code:", msg.code);
      break;
  }
};

// Send user input
term.onData((data) => {
  ws.send(JSON.stringify({ type: "input", data }));
});

// Report resize
const resizeObserver = new ResizeObserver(() => {
  fitAddon.fit();
  ws.send(JSON.stringify({
    type: "resize",
    cols: term.cols,
    rows: term.rows,
  }));
});
resizeObserver.observe(document.getElementById("terminal")!);
```

## Comparison: tmux vs xterm-headless Proxy

| Aspect | tmux | xterm-headless Proxy |
|--------|------|----------------------|
| External dependency | Required | None |
| Buffer access | Shell out to `capture-pane` | Direct API |
| Send input | Shell escape + `send-keys` | `pty.write()` |
| Multi-client | `tmux attach` | WebSocket multicast |
| State persistence | Built-in | In-memory (serialize for reconnect) |
| Server restart | Sessions survive | Sessions lost* |
| Manual debugging | `tmux attach` from terminal | Need debug endpoint |
| Battle-tested | Decades | New implementation |

*Could persist serialized state to disk, but cannot restore running processes.

## Limitations

1. **Server restart loses sessions** - Unlike tmux, cannot reattach to running processes after Node restarts. Mitigation: minimize restarts, or accept ephemeral sessions.

2. **Memory usage** - Each session's terminal state lives in Node heap. Mitigation: limit scrollback, set max sessions.

3. **No manual attach** - Can't `tmux attach` from a terminal for debugging. Mitigation: add a debug WebSocket endpoint or CLI tool.

## Dependencies

```json
{
  "dependencies": {
    "@xterm/headless": "^5.x",
    "@xterm/addon-serialize": "^0.x",
    "node-pty": "^1.x",
    "ws": "^8.x"
  }
}
```

## Future Considerations

- **Scrollback persistence** - Serialize scrollback to disk periodically for crash recovery
- **Session transfer** - Move session between servers (serialize + transfer + restore)
- **Recording/playback** - Store PTY output stream for session replay
- **Read-only clients** - Viewers who can see but not input
