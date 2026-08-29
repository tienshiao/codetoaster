import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CONFIG_DIR = path.join(os.homedir(), ".codetoaster");
const LOG_FILE = path.join(CONFIG_DIR, "codetoaster.log");

function pidFilePath(port: number): string {
  return path.join(CONFIG_DIR, `codetoaster.${port}.pid`);
}

export interface PidInfo {
  pid: number;
  port: number;
  /** Where this daemon can actually be reached, written by the daemon itself.
   * The CLI cannot assume loopback: `--host` binds one address exclusively, so
   * a daemon started on a LAN address refuses `http://localhost:<port>`
   * outright — and a CLI that only knew the port would report the healthy
   * daemon it had just started as not responding. Optional because a pid file
   * written by an older build has no such field, where loopback is right. */
  origin?: string;
}

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function readPidFile(port: number): PidInfo | null {
  try {
    const data = fs.readFileSync(pidFilePath(port), "utf-8");
    return JSON.parse(data) as PidInfo;
  } catch {
    return null;
  }
}

export function writePidFile(pid: number, port: number, origin?: string): void {
  ensureConfigDir();
  fs.writeFileSync(pidFilePath(port), JSON.stringify({ pid, port, origin }));
}

/** How to talk to the daemon on a port: what it recorded about itself, and
 * loopback when it recorded nothing. Every CLI command goes through this rather
 * than assembling a localhost URL, so `--host` moves the whole CLI with it. */
export function daemonBaseUrl(port: number): string {
  return readPidFile(port)?.origin ?? `http://localhost:${port}`;
}

export function removePidFile(port: number): void {
  try {
    fs.unlinkSync(pidFilePath(port));
  } catch {
    // Already gone
  }
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function spawnDaemon(port: number, dbPath?: string, hostname?: string): void {
  ensureConfigDir();

  // Build the command to run the server in foreground mode.
  // Bun.main starts with /$bunfs/ in compiled binaries.
  const isCompiled = Bun.main.startsWith("/$bunfs/");
  const cmd: string[] = isCompiled
    ? [process.execPath, "foreground"]
    : [process.execPath, Bun.main, "foreground"];

  if (port !== 4000) {
    cmd.push("--port", String(port));
  }

  if (dbPath) {
    cmd.push("--db", dbPath);
  }

  // Passed through, so a daemon started in the background binds what the user
  // asked for rather than quietly falling back to loopback.
  if (hostname) {
    cmd.push("--host", hostname);
  }

  const logFd = fs.openSync(LOG_FILE, "a");

  const proc = Bun.spawn(cmd, {
    stdin: "ignore",
    stdout: logFd,
    stderr: logFd,
    env: { ...process.env },
  });

  proc.unref();
  fs.closeSync(logFd);
}

export interface InstanceInfo {
  pid: number;
  port: number;
  reachable: boolean;
}

export async function listAllInstances(): Promise<InstanceInfo[]> {
  ensureConfigDir();
  const glob = new Bun.Glob("codetoaster.*.pid");
  const instances: InstanceInfo[] = [];

  for await (const file of glob.scan(CONFIG_DIR)) {
    const filePath = path.join(CONFIG_DIR, file);
    try {
      const data = fs.readFileSync(filePath, "utf-8");
      const info = JSON.parse(data) as PidInfo;
      if (isProcessRunning(info.pid)) {
        let reachable = false;
        try {
          const res = await fetch(`${info.origin ?? `http://localhost:${info.port}`}/api/ping`);
          reachable = res.ok;
        } catch {}
        instances.push({ pid: info.pid, port: info.port, reachable });
      } else {
        // Stale PID file — clean up
        fs.unlinkSync(filePath);
      }
    } catch {
      // Corrupt PID file — clean up
      try { fs.unlinkSync(filePath); } catch {}
    }
  }

  return instances.sort((a, b) => a.port - b.port);
}

export function getLogFile(): string {
  return LOG_FILE;
}
