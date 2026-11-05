import type { ProcessInfo, ProcessesResponse } from "../types/processes";

/**
 * What is running under a task's terminals, and which ports it holds
 * (TASK-138.1).
 *
 * A task whose agent fans out into subagents, dev servers and test runners
 * shows one interleaved terminal stream; this is the other view of the same
 * work. It is a snapshot taken when asked, from two system tools:
 *
 * - `ps` once for the whole process table, then a walk down from each
 *   terminal's pid. Walking the table in memory rather than asking `ps` per
 *   parent is one spawn however deep the tree is, and `-A` with explicit
 *   columns reads the same on macOS and Linux.
 * - `lsof` for listening TCP sockets, restricted to the pids the walk found,
 *   so it never scans the whole machine's descriptors.
 *
 * The parsers are pure and take the tools' text, so they are tested without
 * spawning anything; `snapshotProcesses` takes the runner as a dependency for
 * the same reason.
 */

export interface PsRow {
  pid: number;
  ppid: number;
  command: string;
}

/** `ps -A -o pid=,ppid=,command=`: two numbers, then the command line, which
 * may itself contain any amount of whitespace. Lines that do not start with
 * two numbers are skipped rather than guessed at. */
export function parsePsTable(output: string): PsRow[] {
  const rows: PsRow[] = [];
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    rows.push({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3]!.trimEnd() });
  }
  return rows;
}

/**
 * `lsof -Fpn` output for listening TCP sockets: a `p<pid>` line opens a
 * process, and each `n<address>` after it is one socket, like `*:3000`,
 * `127.0.0.1:5173` or `[::1]:8080`. The port is whatever follows the last
 * colon. One server listening on both IPv4 and IPv6 is reported once.
 */
export function parseListeningPorts(output: string): Map<number, number[]> {
  const ports = new Map<number, Set<number>>();
  let pid: number | null = null;
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) {
      const value = Number(line.slice(1));
      pid = Number.isInteger(value) && value > 0 ? value : null;
    } else if (line.startsWith("n") && pid !== null) {
      const port = Number(line.slice(line.lastIndexOf(":") + 1));
      if (!Number.isInteger(port) || port <= 0) continue;
      let set = ports.get(pid);
      if (!set) ports.set(pid, (set = new Set()));
      set.add(port);
    }
  }
  return new Map([...ports].map(([p, set]) => [p, [...set].sort((a, b) => a - b)]));
}

export interface ProcessRoot {
  pid: number;
  terminal: ProcessInfo["terminal"];
}

/**
 * Every process at or below each root, depth-first, children in pid order.
 * A root `ps` did not list has exited between the terminal being asked for its
 * pid and the table being read, and contributes nothing. A pid already placed
 * under an earlier root is not placed again, which also keeps a cycle in a
 * malformed table from walking forever.
 */
export function buildProcessTree(rows: readonly PsRow[], roots: readonly ProcessRoot[]): Omit<ProcessInfo, "ports">[] {
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const children = new Map<number, PsRow[]>();
  for (const row of rows) {
    if (row.pid === row.ppid) continue;
    let list = children.get(row.ppid);
    if (!list) children.set(row.ppid, (list = []));
    list.push(row);
  }
  for (const list of children.values()) list.sort((a, b) => a.pid - b.pid);

  const out: Omit<ProcessInfo, "ports">[] = [];
  const placed = new Set<number>();
  const visit = (row: PsRow, depth: number, terminal: ProcessInfo["terminal"]) => {
    if (placed.has(row.pid)) return;
    placed.add(row.pid);
    out.push({ pid: row.pid, ppid: row.ppid, command: row.command, depth, terminal });
    for (const child of children.get(row.pid) ?? []) visit(child, depth + 1, terminal);
  };
  for (const root of roots) {
    const row = byPid.get(root.pid);
    if (row) visit(row, 0, root.terminal);
  }
  return out;
}

/** Runs a command and resolves to what it printed, or null when it could not
 * be run or did not finish. */
export type Capture = (command: string[], options?: CaptureOptions) => Promise<string | null>;

export interface CaptureOptions {
  /** Hand back what a helper printed before it was killed on the timeout,
   * rather than null. Right for `Pty`'s one-line lookups, where whatever came
   * out before the kill is the answer or nothing; wrong for a table, where a
   * cut-off `ps` would silently drop processes from the tree. */
  keepKilledOutput?: boolean;
}

// Long enough for a healthy machine; what stops a wedged mount under `lsof`
// from holding a request open (the reason `Pty`'s lookups are bounded too).
const CAPTURE_TIMEOUT_MS = 2000;
// How long a killed helper gets to exit and hand over what it printed. A slow
// `lsof` that has already written its answer dies on SIGTERM at once, and its
// output is still the answer; only one stuck in an uninterruptible wait
// outlives this, and that one is given up on.
const KILL_GRACE_MS = 250;

/** `Bun.spawn`, never `spawnSync` (which would block the daemon's one event
 * loop for the tool's whole run) and never `Bun.$` (CLAUDE.md), with a kill
 * on the timeout. A non-zero exit still hands back its output: `lsof` exits 1
 * when nothing matched, which is an answer, not a failure. */
export const captureCommand: Capture = async (command, { keepKilledOutput = false } = {}) => {
  let timer: Timer | null = null;
  let killed = false;
  try {
    const proc = Bun.spawn(command, { stdout: "pipe", stderr: "ignore" });
    // Raced rather than awaited after the kill: a helper stuck in an
    // uninterruptible wait (the wedged mount this bound exists for) does not
    // die on SIGTERM, and awaiting its exit would hold the request open anyway.
    // The race is lost only after the grace, so a helper that does die on the
    // kill still answers with what it printed, as the lookups always had it.
    const timedOut = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        killed = true;
        proc.kill();
        timer = setTimeout(() => resolve(null), KILL_GRACE_MS);
      }, CAPTURE_TIMEOUT_MS);
    });
    // Caught here and not only by the try: when the timer wins the race this
    // promise is abandoned, and a read that fails after that would otherwise
    // surface as an unhandled rejection in the daemon.
    const finished = Promise.all([new Response(proc.stdout).text(), proc.exited])
      .then(([output]) => output)
      .catch(() => null);
    const output = await Promise.race([finished, timedOut]);
    return killed && !keepKilledOutput ? null : output;
  } catch {
    // Not installed: Bun.spawn throws before there is a process.
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/** `ps` could not be run or did not answer in time. */
export class ProcessLookupError extends Error {}

/** The processes under `roots` with their listening ports. No roots is a task
 * with nothing running: `live: false`, and no tool is run at all. */
export async function snapshotProcesses(
  roots: readonly ProcessRoot[],
  capture: Capture = captureCommand,
): Promise<ProcessesResponse> {
  if (roots.length === 0) return { live: false, processes: [], portsKnown: true };

  const table = await capture(["ps", "-A", "-o", "pid=,ppid=,command="]);
  // Not an empty tree: "nothing is running" and "could not look" must not
  // read the same, so this is the caller's to report as a failure.
  if (table === null) throw new ProcessLookupError("Could not read the process table");
  const tree = buildProcessTree(parsePsTable(table), roots);
  if (tree.length === 0) return { live: true, processes: [], portsKnown: true };

  const pids = tree.map((p) => p.pid).join(",");
  // `-a` ANDs the selections: these pids, and TCP sockets in LISTEN. Without
  // it lsof ORs them and reports every listener on the machine.
  const listing = await capture(["lsof", "-a", "-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn", "-p", pids]);
  const ports = listing === null ? new Map<number, number[]>() : parseListeningPorts(listing);
  return {
    live: true,
    processes: tree.map((p) => ({ ...p, ports: ports.get(p.pid) ?? [] })),
    portsKnown: listing !== null,
  };
}
