import { describe, expect, test } from "bun:test";
import {
  ProcessLookupError,
  buildProcessTree,
  captureCommand,
  parseListeningPorts,
  parsePsTable,
  snapshotProcesses,
  type Capture,
} from "./processes";

const PS = [
  "    1     0 /sbin/launchd",
  "  100     1 /bin/zsh -l",
  "  110   100 claude --session-id abc",
  "  120   110 node /usr/local/bin/vite --port 5173",
  "  121   110 bun test   --watch",
  "  130   100 sleep 60",
  "  200     1 /bin/zsh -l",
  "  210   200 bun run dev",
  "  999     1 unrelated",
  "garbage line",
].join("\n");

describe("parsePsTable", () => {
  test("reads pid, ppid and the whole command line, spaces and all", () => {
    const rows = parsePsTable(PS);
    expect(rows).toHaveLength(9);
    expect(rows.find((r) => r.pid === 121)).toEqual({ pid: 121, ppid: 110, command: "bun test   --watch" });
  });
});

describe("parseListeningPorts", () => {
  test("ports per pid, IPv4 and IPv6 listeners reported once, sorted", () => {
    const out = ["p120", "f21", "n*:5173", "f22", "n[::1]:5173", "f23", "n127.0.0.1:24678", "p210", "f9", "n*:3000"].join("\n");
    expect(parseListeningPorts(out)).toEqual(
      new Map([
        [120, [5173, 24678]],
        [210, [3000]],
      ]),
    );
  });

  test("an address with no usable port is skipped", () => {
    expect(parseListeningPorts("p5\nn*:*\n")).toEqual(new Map());
  });
});

describe("buildProcessTree", () => {
  test("each root's descendants depth-first, children by pid, unrelated processes left out", () => {
    const tree = buildProcessTree(parsePsTable(PS), [
      { pid: 100, terminal: "agent" },
      { pid: 200, terminal: "shell" },
    ]);
    expect(tree.map((p) => [p.pid, p.depth, p.terminal])).toEqual([
      [100, 0, "agent"],
      [110, 1, "agent"],
      [120, 2, "agent"],
      [121, 2, "agent"],
      [130, 1, "agent"],
      [200, 0, "shell"],
      [210, 1, "shell"],
    ]);
  });

  test("a root that has exited contributes nothing", () => {
    expect(buildProcessTree(parsePsTable(PS), [{ pid: 4242, terminal: "shell" }])).toEqual([]);
  });

  test("a cycle in a malformed table does not walk forever", () => {
    const rows = [
      { pid: 1, ppid: 2, command: "a" },
      { pid: 2, ppid: 1, command: "b" },
    ];
    expect(buildProcessTree(rows, [{ pid: 1, terminal: "agent" }]).map((p) => p.pid)).toEqual([1, 2]);
  });
});

describe("snapshotProcesses", () => {
  function capture(answers: { ps: string | null; lsof: string | null }) {
    const calls: string[][] = [];
    const run: Capture = async (command) => {
      calls.push(command);
      return command[0] === "ps" ? answers.ps : answers.lsof;
    };
    return { run, calls };
  }

  test("no roots is a task with nothing running, and runs no tool", async () => {
    const { run, calls } = capture({ ps: PS, lsof: "" });
    expect(await snapshotProcesses([], run)).toEqual({ live: false, processes: [], portsKnown: true });
    expect(calls).toEqual([]);
  });

  test("ports are attached, and lsof is asked about the tree's pids only", async () => {
    const { run, calls } = capture({ ps: PS, lsof: "p120\nn*:5173\n" });
    const result = await snapshotProcesses([{ pid: 110, terminal: "agent" }], run);
    expect(result.live).toBe(true);
    expect(result.portsKnown).toBe(true);
    expect(result.processes.find((p) => p.pid === 120)?.ports).toEqual([5173]);
    expect(result.processes.find((p) => p.pid === 121)?.ports).toEqual([]);
    const lsof = calls.find((c) => c[0] === "lsof")!;
    expect(lsof).toContain("-a");
    expect(lsof.at(-1)).toBe("110,120,121");
  });

  test("a port lookup that failed says so rather than claiming no ports", async () => {
    const { run } = capture({ ps: PS, lsof: null });
    const result = await snapshotProcesses([{ pid: 110, terminal: "agent" }], run);
    expect(result.portsKnown).toBe(false);
    expect(result.processes).toHaveLength(3);
  });

  test("a process table that could not be read is an error, not an empty tree", async () => {
    const { run } = capture({ ps: null, lsof: "" });
    expect(snapshotProcesses([{ pid: 110, terminal: "agent" }], run)).rejects.toBeInstanceOf(ProcessLookupError);
  });

  test("a helper killed on the timeout answers null, or what it printed when asked to keep it", async () => {
    // Prints its answer and then hangs: the slow-lsof shape. Both run at once,
    // so the bound is paid once.
    const command = ["sh", "-c", "echo answer; exec sleep 30"];
    const [dropped, kept] = await Promise.all([
      captureCommand(command),
      captureCommand(command, { keepKilledOutput: true }),
    ]);
    expect(dropped).toBeNull();
    expect(kept).toBe("answer\n");
  }, 10_000);

  test("against the real tools: this test process is found under its own pid", async () => {
    const result = await snapshotProcesses([{ pid: process.pid, terminal: "agent" }]);
    expect(result.live).toBe(true);
    expect(result.processes[0]?.pid).toBe(process.pid);
  });
});
