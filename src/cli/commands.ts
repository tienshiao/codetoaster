import {
  readPidFile,
  writePidFile,
  removePidFile,
  isProcessRunning,
  spawnDaemon,
  findPidFileByPid,
  originOf,
  getLogFile,
  listAllInstances,
  daemonBaseUrl,
} from "./daemon";
import { formatTable, formatAge, formatSessionId } from "./format";
import { startServer, reachableOrigin } from "../server";

// Asked of the daemon rather than assumed. `--host` binds one address
// exclusively, so a daemon on a LAN address refuses `http://localhost:<port>`
// and every command here would report a perfectly healthy daemon as not
// running — `start` loudest of all, which polls, gives up, and exits 1 on the
// daemon it just launched.
/** Reads a JSON body, or exits with what the daemon actually said.
 *
 * Without this a refusal reaches the caller as `x.map is not a function`,
 * because the error body is an object and the caller expected an array — a
 * TypeError where the daemon had sent a perfectly good explanation. */
async function readJson<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) {
    const detail = await res.json().then((body: any) => body?.error).catch(() => undefined);
    console.error(`Could not ${what}: ${detail ?? `${res.status} ${res.statusText}`}`);
    process.exit(1);
  }
  return (await res.json()) as T;
}

function getBaseUrl(port: number): string {
  return daemonBaseUrl(port);
}

async function isDaemonReachable(port: number): Promise<boolean> {
  return isOriginReachable(getBaseUrl(port));
}

async function isOriginReachable(origin: string): Promise<boolean> {
  try {
    const res = await fetch(`${origin}/api/ping`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function cmdStart(port: number, dbPath?: string, hostname?: string, allowedHosts?: string[]): Promise<void> {
  const pidInfo = readPidFile(port);
  if (pidInfo && isProcessRunning(pidInfo.pid)) {
    if (await isDaemonReachable(port)) {
      console.log(`Already running (pid ${pidInfo.pid}, port ${port})`);
      return;
    }
    // Stale — process exists but not responding
    removePidFile(port);
  } else if (pidInfo) {
    // Stale PID file
    removePidFile(port);
  }

  const daemonPid = spawnDaemon(port, dbPath, hostname, allowedHosts);

  // Found by pid, not by the port that was asked for. `--port 0` means "you
  // decide", and the kernel decides inside the child: it binds, then writes its
  // pid file at the port it actually got. Polling `http://localhost:0` and a
  // `codetoaster.0.pid` that will never exist is how a daemon that was running
  // and listening got reported as dead — and then left running, since nothing
  // had a handle on it either.
  // Ten seconds, not five. The loop breaks the instant the child dies, so a
  // real failure never waits this out — the budget is only ever spent on a
  // daemon that is still coming up, and running thirty agents on one machine
  // is this product's own use case rather than an edge of it.
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    await Bun.sleep(i === 0 ? 1000 : 300);
    const info = findPidFileByPid(daemonPid);
    if (info && (await isOriginReachable(originOf(info)))) {
      console.log(`Started (pid ${info.pid}, port ${info.port})`);
      console.log(`Web UI: ${originOf(info)}`);
      return;
    }
    // It exited on its own — a port already in use, a bad --db path. The
    // remaining attempts have nothing left to wait for.
    if (!isProcessRunning(daemonPid)) break;
  }

  // A daemon that got as far as writing a pid file is bound and listening — the
  // file is written after serve() — and it named the port it got. That is not
  // the orphan this block is for: it is findable, `stop` can reach it, and it
  // may simply have been slower than the budget. Killing it would take down a
  // healthy daemon on exactly the loaded machine that made it slow. So say
  // where it is and leave it alone.
  //
  // Alive, though: a pid file is only evidence that it *was* listening. A
  // daemon that bound, wrote the file and then died — a migration that threw
  // after serve(), a crash on the first request — leaves exactly the same
  // file, and reporting that as "listening, stop it with --port N" sends the
  // user after a process that is not there. That one falls through to the
  // sweep at the end of this function, which is already looking for a pid file
  // naming a process that is not running: nothing else would ever clear it,
  // since `start` only consults the port it was asked for and `--port 0` is
  // never the port it got.
  const bound = findPidFileByPid(daemonPid);
  if (bound && isProcessRunning(daemonPid)) {
    console.error(`Daemon is listening on port ${bound.port} but did not answer ${originOf(bound)}/api/ping.`);
    console.error(`  Stop it with: codetoaster stop --port ${bound.port}`);
    console.error(`  Logs: ${getLogFile()}`);
    process.exit(1);
  }

  // Never bound, and still alive: a process that will go on starting up and
  // bind a port after we have told the user it failed. Nothing would know that
  // port — that is the orphan, and we started it, so it is ours to take down.
  if (isProcessRunning(daemonPid)) {
    try { process.kill(daemonPid); } catch {}
  }
  // Looked for again after the signal: one that finished binding in the window
  // between the check above and the kill writes its file late, and a file
  // naming a process we have just killed is the same orphan by other means.
  const late = findPidFileByPid(daemonPid);
  if (late) removePidFile(late.port);

  console.error("Daemon started but not responding. Check logs:");
  console.error(`  ${getLogFile()}`);
  process.exit(1);
}

export async function cmdForeground(port: number, dbPath?: string, hostname?: string, allowedHosts?: string[]): Promise<void> {
  const server = startServer({ port, dbPath, hostname, allowedHosts });
  // The origin goes in the pid file because the daemon is the only party that
  // knows it: `--port 0` resolves late, and `--host` decides whether loopback
  // is reachable at all. Everything else — the CLI on this machine, and the
  // hooks the agents run — reads it back from there.
  const boundPort = server.port ?? port;
  writePidFile(process.pid, boundPort, reachableOrigin(hostname, boundPort));

  const cleanup = () => {
    removePidFile(boundPort);
    process.exit(0);
  };
  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);

  console.log(`Server running at ${server.url}`);
}

export async function cmdList(port: number): Promise<void> {
  if (!(await isDaemonReachable(port))) {
    console.log("Daemon is not running.");
    process.exit(1);
  }

  const res = await fetch(`${getBaseUrl(port)}/api/tasks`);
  // The v2 shape: `title` is the task's stored label (v1's `name`), and
  // `terminalTitle` is what the program inside is calling itself (v1's `title`).
  const sessions = await readJson<Array<{
    id: string;
    title: string;
    terminalTitle: string;
    clientCount: number;
    size: { cols: number; rows: number } | null;
    createdAt: number;
    exited: boolean;
    cwd: string | null;
  }>>(res, "list sessions");

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
    s.title,
    s.terminalTitle || "",
    formatCwd(s.cwd),
    String(s.clientCount),
    s.size ? `${s.size.cols}x${s.size.rows}` : "-",
    formatAge(s.createdAt),
    s.exited ? "exited" : "running",
  ]);

  console.log(formatTable(headers, rows));
}

export async function cmdKill(target: string, port: number): Promise<void> {
  if (!(await isDaemonReachable(port))) {
    console.log("Daemon is not running.");
    process.exit(1);
  }

  const res = await fetch(`${getBaseUrl(port)}/api/tasks`);
  const sessions = await readJson<Array<{ id: string; title: string }>>(res, "list sessions");

  // Match by name (exact), id prefix, or full id
  const match = sessions.find(
    (s) =>
      s.title === target ||
      s.id === target ||
      s.id.startsWith(target) ||
      formatSessionId(s.id).startsWith(target)
  );

  if (!match) {
    console.error(`No session matching "${target}"`);
    process.exit(1);
  }

  const killRes = await fetch(`${getBaseUrl(port)}/api/tasks/${match.id}`, {
    method: "DELETE",
  });

  if (!killRes.ok) {
    console.error("Failed to kill session.");
    process.exit(1);
  }
  console.log(`Killed session "${match.title}" (${formatSessionId(match.id)})`);
  // A kill now takes the task's checkout with it (TASK-31), and the one thing
  // it deliberately does *not* take is a branch whose commits are nowhere else.
  // Said out loud, because a branch left behind is a file on the user's disk
  // they did not ask for and would otherwise find months later — and because
  // "kept" is the good news: it is where the work went.
  const outcome = await killRes.json().catch(() => null) as { branchKept?: string | null } | null;
  if (outcome?.branchKept) console.log(outcome.branchKept);
}

export async function cmdConnections(port: number): Promise<void> {
  if (!(await isDaemonReachable(port))) {
    console.log("Daemon is not running.");
    process.exit(1);
  }

  const res = await fetch(`${getBaseUrl(port)}/api/connections`);
  const connections = await readJson<Array<{
    clientId: string;
    ptyIds: string[];
  }>>(res, "list connections");

  if (connections.length === 0) {
    console.log("No connected clients.");
    return;
  }

  // A client can hold several sessions at once now — one per open terminal.
  const headers = ["CLIENT", "TERMINALS"];
  const rows = connections.map((c) => [
    c.clientId,
    c.ptyIds.length > 0 ? c.ptyIds.map(formatSessionId).join(", ") : "(detached)",
  ]);

  console.log(formatTable(headers, rows));
}

export async function cmdOpen(port: number): Promise<void> {
  if (!(await isDaemonReachable(port))) {
    console.log("Daemon is not running.");
    process.exit(1);
  }

  const url = getBaseUrl(port);
  const cmd = process.platform === "darwin" ? "open" : "xdg-open";
  Bun.spawn([cmd, url]);
  console.log(`Opening ${url}`);
}

export async function cmdStop(port: number): Promise<void> {
  const pidInfo = readPidFile(port);
  if (!pidInfo) {
    console.log("Daemon is not running (no PID file).");
    return;
  }

  // Try graceful shutdown via HTTP
  try {
    await fetch(`${getBaseUrl(port)}/api/shutdown`, { method: "POST" });
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

  removePidFile(port);
}

export async function cmdStatus(port: number): Promise<void> {
  const pidInfo = readPidFile(port);
  if (!pidInfo) {
    console.log("Not running (no PID file).");
    return;
  }

  if (!isProcessRunning(pidInfo.pid)) {
    console.log(`Not running (stale PID file, pid ${pidInfo.pid})`);
    removePidFile(port);
    return;
  }

  try {
    const res = await fetch(`${getBaseUrl(port)}/api/ping`);
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
    console.log(`  Port:     ${port}`);
    console.log(`  Uptime:   ${formatAge(Date.now() - info.uptime * 1000)}`);
    console.log(`  Sessions: ${info.sessions}`);
    console.log(`  Web UI:   ${getBaseUrl(port)}`);
  } catch {
    console.log(`Running (pid ${pidInfo.pid}, port ${port}) but not responding to HTTP`);
  }
}

export async function cmdInstances(): Promise<void> {
  const instances = await listAllInstances();

  if (instances.length === 0) {
    console.log("No running instances.");
    return;
  }

  const headers = ["PORT", "PID", "STATUS", "URL"];
  const rows = instances.map((i) => [
    String(i.port),
    String(i.pid),
    i.reachable ? "running" : "not responding",
    // The URL that instance actually answers on, which is not loopback once
    // someone has bound `--host`.
    daemonBaseUrl(i.port),
  ]);

  console.log(formatTable(headers, rows));
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
  instances       List all running instances (across all ports)
  hook            Report a Claude Code hook to the daemon (run by the agent)
  help            Show this help message

Options:
  --port <port>   Server port (default: 4000, or PORT env)
  --db <path>     Database path (default: ~/.codetoaster/data.db)
  --host <addr>   Address to bind (default: 127.0.0.1; widen at your own risk)
  --allowed-host <name>  Extra host name the UI may be reached by (repeatable)
  --version       Show version
  --help          Show this help message`);
}
