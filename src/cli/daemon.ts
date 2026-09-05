import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { formatDuration } from "./duration";
import type { ServerOptions } from "../server";

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

/** The pid file a given process wrote, whatever port it landed on.
 *
 * `--port 0` means "you decide", and the kernel decides late: the daemon knows
 * its port only once it is listening, and writes the file at that port. A
 * caller that derived the path from the number it asked for would look for
 * `codetoaster.0.pid` forever. The pid is the one thing that is known before
 * the bind and unchanged after it, so that is what the file is found by. */
export function findPidFileByPid(pid: number): PidInfo | null {
  ensureConfigDir();
  for (const file of fs.readdirSync(CONFIG_DIR)) {
    if (!file.startsWith("codetoaster.") || !file.endsWith(".pid")) continue;
    try {
      const info = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, file), "utf-8")) as PidInfo;
      if (info.pid === pid) return info;
    } catch {
      // Corrupt or half-written; the next attempt will read it whole.
    }
  }
  return null;
}

/** Where a daemon can be reached, from what it wrote about itself. */
export function originOf(info: PidInfo): string {
  return info.origin ?? `http://localhost:${info.port}`;
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

/** Everything the daemon needs to be told, in one object rather than in a
 * growing row of positionals. The port is the one thing always known — the CLI
 * has a default for it — and the rest is `ServerOptions` because the background
 * daemon is a foreground server with a detach in front of it: anything the
 * server can be configured with has to survive the respawn, or `start` and
 * `foreground` quietly mean different things. */
export type DaemonOptions = ServerOptions & { port: number };

/** The daemon's own argv, after `foreground`. Pure and exported because it is
 * the whole of the respawn contract: every option that reaches `startServer`
 * directly under `foreground` has to be re-spelled here to reach it under
 * `start`, and a flag forgotten in this list is a setting that silently works
 * in the foreground and is lost in the background. */
export function daemonArgs(options: DaemonOptions): string[] {
  const args: string[] = [];

  if (options.port !== 4000) {
    args.push("--port", String(options.port));
  }

  if (options.dbPath) {
    args.push("--db", options.dbPath);
  }

  // Passed through, so a daemon started in the background binds what the user
  // asked for rather than quietly falling back to loopback.
  if (options.hostname) {
    args.push("--host", options.hostname);
  }

  for (const name of options.allowedHosts ?? []) {
    args.push("--allowed-host", name);
  }

  // Tested against `undefined` rather than for truthiness: `0` is a real value
  // here — it is how a tier is turned off — and a falsy check would drop it,
  // handing the child the thirty-minute default the user had just disabled.
  if (options.harvestAfterMs !== undefined) {
    args.push("--harvest-after", formatDuration(options.harvestAfterMs));
  }

  if (options.evictAfterMs !== undefined) {
    args.push("--evict-after", formatDuration(options.evictAfterMs));
  }

  return args;
}

/** Starts the daemon and returns its pid — the only handle on it that exists
 * before it has bound a port, and therefore the only way to find it again, or
 * to clean it up if it never comes up. */
export function spawnDaemon(options: DaemonOptions): number {
  ensureConfigDir();

  // Build the command to run the server in foreground mode.
  // Bun.main starts with /$bunfs/ in compiled binaries.
  const isCompiled = Bun.main.startsWith("/$bunfs/");
  const cmd: string[] = isCompiled
    ? [process.execPath, "foreground"]
    : [process.execPath, Bun.main, "foreground"];

  cmd.push(...daemonArgs(options));

  const logFd = fs.openSync(LOG_FILE, "a");

  const proc = Bun.spawn(cmd, {
    stdin: "ignore",
    stdout: logFd,
    stderr: logFd,
    env: { ...process.env },
  });

  proc.unref();
  fs.closeSync(logFd);
  return proc.pid;
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
