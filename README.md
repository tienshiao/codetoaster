# CodeToaster

Browser-based terminal multiplexer. Multiple shell sessions managed via WebSocket, with multi-client support — multiple browsers can attach to the same session.

## Features

### Sessions
- Multiple named shell sessions with sidebar navigation
- Multi-client support: share a session across browser tabs/devices
- Server-side terminal state via `@xterm/headless` — reconnect without losing output
- New sessions inherit the working directory of the current shell
- Session renaming and close confirmation with session name/title
- Live terminal preview on sidebar hover

### Folders
- Organize sessions into collapsible folders
- Drag-and-drop reordering of sessions and folders
- Create, rename, and delete folders
- Default "General" folder for ungrouped sessions

### Terminal
- Full terminal emulation with `@xterm/xterm` and 10,000-line scrollback
- Terminal size negotiation (smallest-wins across connected clients)
- `TERM=xterm-256color` for proper color and Nerd Font support
- Clickable URLs via web links addon
- In-terminal search with match highlighting and navigation (Cmd/Ctrl+F)
- Resize HUD showing current dimensions
- Touch scrolling support for mobile

### Command Palette
- Quick access via Cmd/Ctrl+Shift+P
- Search sessions by name, title, or ID
- Actions: new session, close session, rename session, toggle sidebar

### Customization
- 100+ terminal color schemes with palette preview
- 5 font families: JetBrains Mono, Fira Code, Hack, MesloLGS, Cascadia Code (all Nerd Font Mono)
- Adjustable font size (12–24px)
- App theme: system, light, or dark mode
- All preferences persisted to localStorage

### File Upload
- Drag-and-drop files onto the terminal to upload
- Paste images/files from clipboard
- Uploaded file paths are injected into the shell

### Notifications
- Desktop notifications via OSC 777, OSC 9, and OSC 99 (Kitty protocol)
- Browser notifications when the window is not focused
- Configurable notification sounds: chime, bell, drop, ping
- Separate bell sound control for BEL character
- Amber indicator dot for unacknowledged notifications

### Code Review
- Built-in diff viewer with unified diff parsing
- Word-level diff highlighting with syntax tokenization
- Inline and file-level comments on diff lines
- Hierarchical file tree navigation
- Single-file and all-files view modes (auto-switches for large diffs)
- Expandable context lines around hunks
- Image diff support (side-by-side, added, deleted)
- Generate agent prompts from code review feedback
- Terminal/Diff tab switching per session

### Activity Tracking
- Animated activity indicator per session (300ms debounce)
- Color-coded status dots: active, inactive, notification pending, exited

### Keyboard Shortcuts

| Action | Mac | Windows/Linux |
|--------|-----|---------------|
| Command Palette | Cmd+Shift+P | Ctrl+Shift+P |
| Search Terminal | Cmd+F | Ctrl+F |
| Find Next | Cmd+G | Ctrl+G |
| Find Previous | Shift+Cmd+G | Shift+Ctrl+G |
| Toggle Sidebar | Cmd+B | Ctrl+B |

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

Starts the TanStack Router watcher and Bun dev server in foreground with hot reload on port 4000.

### Production

```bash
bun run start
```

### Build standalone binary

```bash
bun run build:server
```

Produces a `codetoaster` binary in `dist-executables/`.

## CLI

CodeToaster includes a tmux-like CLI. The default command starts a background daemon; subcommands communicate with it over HTTP.

```
Usage: codetoaster [command] [options]

Commands:
  (default)       Start daemon in background
  foreground, fg  Run server in foreground (no detach)
  list, ls        List sessions
  kill <session>  Kill a session by name or ID prefix
  connections     List connected WebSocket clients
  open            Open web UI in default browser
  stop            Stop the daemon
  status          Check if daemon is running
  instances       List all running instances (across all ports)
  help            Show this help message

Options:
  --port <port>   Server port (default: 4000, or PORT env)
  --version       Show version
  --help          Show this help message
```

### Examples

```bash
# Start the daemon
codetoaster

# Check status
codetoaster status

# List sessions with CWD, client count, and age
codetoaster ls

# Kill a session by name or ID prefix
codetoaster kill my-session

# Open the web UI
codetoaster open

# List all running instances across ports
codetoaster instances

# Stop the daemon
codetoaster stop
```

The daemon stores its PID file and logs in `~/.codetoaster/`.
