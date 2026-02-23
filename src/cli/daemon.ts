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

export function writePidFile(pid: number, port: number): void {
  ensureConfigDir();
  fs.writeFileSync(pidFilePath(port), JSON.stringify({ pid, port }));
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

export function spawnDaemon(port: number): void {
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
          const res = await fetch(`http://localhost:${info.port}/api/ping`);
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
