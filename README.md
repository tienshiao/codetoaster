# CodeToaster

Browser-based terminal multiplexer. Multiple shell sessions managed via WebSocket, with multi-client support — multiple browsers can attach to the same session.

## Features

- Multiple named shell sessions with sidebar navigation
- Multi-client support: share a session across browser tabs/devices
- Server-side terminal state via `@xterm/headless` — reconnect without losing output
- Terminal size negotiation (smallest-wins across connected clients)
- Drag-and-drop and paste-to-upload for files and images
- Activity indicators per session

## Tech Stack

- **Runtime:** [Bun](https://bun.sh)
- **Server:** `Bun.serve()` with WebSocket and HTML imports
- **Frontend:** React 19, TanStack Router, Tailwind CSS 4, shadcn/ui
- **Terminal:** `@xterm/xterm` (client) + `@xterm/headless` (server)
- **PTY:** `Bun.spawn()` with `pty: true`

## Getting Started

```bash
bun install
```

### Development

```bash
bun run dev
```

Starts the TanStack Router watcher and Bun dev server with hot reload on port 4000.

### Production

```bash
bun run start
```

### Build standalone binary

```bash
bun run build:server
```
