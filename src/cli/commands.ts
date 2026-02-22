import {
  readPidFile,
  writePidFile,
  removePidFile,
  isProcessRunning,
  spawnDaemon,
  getLogFile,
} from "./daemon";
import { formatTable, formatAge, formatSessionId } from "./format";
import { startServer } from "../server";

function getBaseUrl(port: number): string {
  return `http://localhost:${port}`;
}

async function isDaemonReachable(port: number): Promise<boolean> {
  try {
    const res = await fetch(`${getBaseUrl(port)}/api/ping`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function cmdStart(port: number): Promise<void> {
  const pidInfo = readPidFile();
  if (pidInfo && isProcessRunning(pidInfo.pid)) {
    if (await isDaemonReachable(pidInfo.port)) {
      console.log(`Already running (pid ${pidInfo.pid}, port ${pidInfo.port})`);
      return;
    }
    // Stale — process exists but not responding
    removePidFile();
  } else if (pidInfo) {
    // Stale PID file
    removePidFile();
  }

  spawnDaemon(port);

  // Wait for daemon to become reachable
  const maxAttempts = 10;
  for (let i = 0; i < maxAttempts; i++) {
    await Bun.sleep(300);
    if (await isDaemonReachable(port)) {
      const info = readPidFile();
      console.log(`Started (pid ${info?.pid ?? "?"}, port ${port})`);
      console.log(`Web UI: ${getBaseUrl(port)}`);
      return;
    }
  }

  console.error("Daemon started but not responding. Check logs:");
  console.error(`  ${getLogFile()}`);
  process.exit(1);
}

export async function cmdForeground(port: number): Promise<void> {
  const server = startServer({ port });
  writePidFile(process.pid, port);

  const cleanup = () => {
    removePidFile();
    process.exit(0);
  };
  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);

  console.log(`Server running at ${server.url}`);
}

export async function cmdList(port: number): Promise<void> {
  const pidInfo = readPidFile();
  const targetPort = pidInfo?.port ?? port;

  if (!(await isDaemonReachable(targetPort))) {
    console.log("Daemon is not running.");
    process.exit(1);
  }

  const res = await fetch(`${getBaseUrl(targetPort)}/api/sessions`);
  const sessions = (await res.json()) as Array<{
    id: string;
    name: string;
    title: string;
    clientCount: number;
    size: { cols: number; rows: number } | null;
    createdAt: number;
    exited: boolean;
    cwd: string | null;
  }>;

  if (sessions.length === 0) {
    console.log("No sessions.");
    return;
  }

  const homedir = process.env.HOME ?? "";
  const formatCwd = (cwd: string | null) => {
    if (!cwd) return "-";
    if (homedir && cwd.startsWith(homedir)) return "~" + cwd.slice(homedir.length);
    return cwd;
  };

  const headers = ["ID", "NAME", "TITLE", "CWD", "CLIENTS", "SIZE", "AGE", "STATUS"];
  const rows = sessions.map((s) => [
    formatSessionId(s.id),
    s.name,
    s.title || "",
    formatCwd(s.cwd),
    String(s.clientCount),
    s.size ? `${s.size.cols}x${s.size.rows}` : "-",
    formatAge(s.createdAt),
    s.exited ? "exited" : "running",
  ]);

  console.log(formatTable(headers, rows));
}

export async function cmdKill(target: string, port: number): Promise<void> {
  const pidInfo = readPidFile();
  const targetPort = pidInfo?.port ?? port;

  if (!(await isDaemonReachable(targetPort))) {
    console.log("Daemon is not running.");
    process.exit(1);
  }

  const res = await fetch(`${getBaseUrl(targetPort)}/api/sessions`);
  const sessions = (await res.json()) as Array<{ id: string; name: string }>;

  // Match by name (exact), id prefix, or full id
  const match = sessions.find(
    (s) =>
      s.name === target ||
      s.id === target ||
      s.id.startsWith(target) ||
      formatSessionId(s.id).startsWith(target)
  );

  if (!match) {
    console.error(`No session matching "${target}"`);
    process.exit(1);
  }

  const killRes = await fetch(`${getBaseUrl(targetPort)}/api/sessions/${match.id}`, {
    method: "DELETE",
  });

  if (killRes.ok) {
    console.log(`Killed session "${match.name}" (${formatSessionId(match.id)})`);
  } else {
    console.error("Failed to kill session.");
    process.exit(1);
  }
}

export async function cmdConnections(port: number): Promise<void> {
  const pidInfo = readPidFile();
  const targetPort = pidInfo?.port ?? port;

  if (!(await isDaemonReachable(targetPort))) {
    console.log("Daemon is not running.");
    process.exit(1);
  }

  const res = await fetch(`${getBaseUrl(targetPort)}/api/connections`);
  const connections = (await res.json()) as Array<{
    clientId: string;
    sessionId: string | null;
  }>;

  if (connections.length === 0) {
    console.log("No connected clients.");
    return;
  }

  const headers = ["CLIENT", "SESSION"];
  const rows = connections.map((c) => [
    c.clientId,
    c.sessionId ? formatSessionId(c.sessionId) : "(detached)",
  ]);

  console.log(formatTable(headers, rows));
}

export async function cmdOpen(): Promise<void> {
  const pidInfo = readPidFile();
  if (!pidInfo || !isProcessRunning(pidInfo.pid)) {
    console.log("Daemon is not running.");
    process.exit(1);
  }

  if (!(await isDaemonReachable(pidInfo.port))) {
    console.log("Daemon is not responding.");
    process.exit(1);
  }

  const url = getBaseUrl(pidInfo.port);
  const cmd = process.platform === "darwin" ? "open" : "xdg-open";
  Bun.spawn([cmd, url]);
  console.log(`Opening ${url}`);
}

export async function cmdStop(port: number): Promise<void> {
  const pidInfo = readPidFile();
  if (!pidInfo) {
    console.log("Daemon is not running (no PID file).");
    return;
  }

  const targetPort = pidInfo.port;

  // Try graceful shutdown via HTTP
  try {
    await fetch(`${getBaseUrl(targetPort)}/api/shutdown`, { method: "POST" });
    console.log(`Stopped daemon (pid ${pidInfo.pid})`);

    // Wait briefly for it to actually exit
    for (let i = 0; i < 10; i++) {
      await Bun.sleep(100);
      if (!isProcessRunning(pidInfo.pid)) return;
    }
  } catch {
    // HTTP failed, try SIGTERM
  }

  if (isProcessRunning(pidInfo.pid)) {
    try {
      process.kill(pidInfo.pid, "SIGTERM");
      console.log(`Sent SIGTERM to pid ${pidInfo.pid}`);
    } catch {
      // Process already gone
    }
  }

  removePidFile();
}

export async function cmdStatus(port: number): Promise<void> {
  const pidInfo = readPidFile();
  if (!pidInfo) {
    console.log("Not running (no PID file).");
    return;
  }

  if (!isProcessRunning(pidInfo.pid)) {
    console.log(`Not running (stale PID file, pid ${pidInfo.pid})`);
    removePidFile();
    return;
  }

  try {
    const res = await fetch(`${getBaseUrl(pidInfo.port)}/api/ping`);
    const info = (await res.json()) as {
      status: string;
      version: string;
      pid: number;
      uptime: number;
      sessions: number;
    };
    console.log(`Running`);
    console.log(`  Version:  ${info.version}`);
    console.log(`  PID:      ${info.pid}`);
    console.log(`  Port:     ${pidInfo.port}`);
    console.log(`  Uptime:   ${formatAge(Date.now() - info.uptime * 1000)}`);
    console.log(`  Sessions: ${info.sessions}`);
    console.log(`  Web UI:   ${getBaseUrl(pidInfo.port)}`);
  } catch {
    console.log(`Running (pid ${pidInfo.pid}, port ${pidInfo.port}) but not responding to HTTP`);
  }
}

export function cmdHelp(): void {
  console.log(`Usage: codetoaster [command] [options]

Commands:
  (default)       Start daemon in background
  foreground, fg  Run server in foreground (no detach)
  list, ls        List sessions
  kill <session>  Kill a session by name or ID prefix
  connections     List connected WebSocket clients
  open            Open web UI in default browser
  stop            Stop the daemon
  status          Check if daemon is running
  help            Show this help message

Options:
  --port <port>   Server port (default: 4000, or PORT env)
  --version       Show version
  --help          Show this help message`);
}
