import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CONFIG_DIR = path.join(os.homedir(), ".codetoaster");
const PID_FILE = path.join(CONFIG_DIR, "codetoaster.pid");
const LOG_FILE = path.join(CONFIG_DIR, "codetoaster.log");

export interface PidInfo {
  pid: number;
  port: number;
}

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function readPidFile(): PidInfo | null {
  try {
    const data = fs.readFileSync(PID_FILE, "utf-8");
    return JSON.parse(data) as PidInfo;
  } catch {
    return null;
  }
}

export function writePidFile(pid: number, port: number): void {
  ensureConfigDir();
  fs.writeFileSync(PID_FILE, JSON.stringify({ pid, port }));
}

export function removePidFile(): void {
  try {
    fs.unlinkSync(PID_FILE);
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
  // Handle both `bun src/index.ts` and compiled binary cases.
  const argv = process.argv;
  let cmd: string[];

  if (argv[0]?.endsWith("bun") || argv[0]?.endsWith("bun.exe")) {
    // Running as `bun src/index.ts` — respawn with same entrypoint
    cmd = [argv[0]!, argv[1]!, "foreground"];
  } else {
    // Compiled binary — just add foreground arg
    cmd = [argv[0]!, "foreground"];
  }

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

export function getLogFile(): string {
  return LOG_FILE;
}
