import { test, expect, describe, afterEach } from "bun:test";
import * as os from "os";
import { Database } from "bun:sqlite";
import type { Server } from "bun";
import { applyMigrations } from "./db";
import { TaskManager } from "./tasks/manager";
import { terminalSocketCompression } from "./xtmux/socket";
import type { ServerMessage, WebSocketData } from "./xtmux/types";
import { LoadSampler, sendLoadHistory, streamLoad, type CpuTimes } from "./system-load";
import { waitFor } from "../../test/wait";

/** One core's counters, cumulative as the kernel reports them. */
function core(busy: number, idle: number): CpuTimes {
  // Busy split over the fields the sampler sums, so a field it forgot would
  // show up as a wrong percentage.
  return { times: { user: busy / 2, nice: busy / 4, sys: busy / 8, irq: busy / 8, idle } };
}

/** A sampler fed a script of `os.cpus()` readings, on a clock moving two
 * seconds a sample. */
function scripted(readings: CpuTimes[][], loads: number[][] = [[1.234, 0.5, 0.25]]) {
  let i = 0;
  let l = 0;
  let t = 1_000_000;
  let reads = 0;
  const sampler = new LoadSampler({
    cpus: () => {
      reads++;
      return readings[Math.min(i++, readings.length - 1)]!;
    },
    loadavg: () => loads[Math.min(l++, loads.length - 1)]!,
    now: () => (t += 2_000),
    capacity: 4,
  });
  return { sampler, reads: () => reads };
}

describe("the CPU figure", () => {
  test("the first reading is a baseline, not a sample", () => {
    const { sampler } = scripted([[core(100, 900)]]);
    // Since-boot counters would give the uptime average here, which looks live
    // and is not.
    expect(sampler.sample()).toBeNull();
    expect(sampler.history()).toEqual([]);
  });

  test("is the busy share of the delta across every core", () => {
    const { sampler } = scripted([
      [core(100, 900), core(0, 1000)],
      // Core 0: +150 busy, +50 idle. Core 1: +50 busy, +150 idle. 200 of 400.
      [core(250, 950), core(50, 1150)],
      // Core 0 fully busy, core 1 fully idle, uneven totals: 300 of 400.
      [core(550, 950), core(50, 1250)],
    ]);
    sampler.baseline();
    expect(sampler.sample()?.cpu).toBe(50);
    expect(sampler.sample()?.cpu).toBe(75);
  });

  test("rounds to one decimal", () => {
    const { sampler } = scripted([[core(0, 0)], [core(1, 2)]]);
    sampler.baseline();
    expect(sampler.sample()?.cpu).toBe(33.3);
  });

  test("an interval whose counters ran backwards is null, and the next is measured from it", () => {
    const { sampler } = scripted([
      [core(500, 500)],
      [core(100, 100)],
      [core(150, 150)],
    ]);
    sampler.baseline();
    expect(sampler.sample()?.cpu).toBeNull();
    expect(sampler.sample()?.cpu).toBe(50);
  });

  test("a core appearing makes that interval null rather than a sum over different things", () => {
    const { sampler } = scripted([
      [core(0, 100)],
      [core(50, 150), core(0, 0)],
      [core(100, 200), core(100, 0)],
    ]);
    sampler.baseline();
    const changed = sampler.sample();
    expect(changed?.cpu).toBeNull();
    expect(changed?.cores).toBe(2);
    expect(sampler.sample()?.cpu).toBe(75);
  });

  test("no time passing is null, not a division by zero", () => {
    const { sampler } = scripted([[core(10, 10)]]);
    sampler.baseline();
    expect(sampler.sample()?.cpu).toBeNull();
  });
});

describe("the sample", () => {
  test("carries the load averages to two decimals, the core count and the clock", () => {
    const { sampler } = scripted([[core(0, 0)], [core(1, 1)]], [[3.14159, 2.71828, 1.41421]]);
    sampler.baseline();
    expect(sampler.sample()).toEqual({
      at: 1_002_000,
      cpu: 50,
      load: [3.14, 2.72, 1.41],
      cores: 1,
    });
  });
});

describe("the ring", () => {
  test("keeps the newest `capacity` samples, oldest first", () => {
    const readings = Array.from({ length: 8 }, (_, n) => [core(n * 10, n * 10)]);
    const { sampler } = scripted(readings);
    sampler.baseline();
    for (let n = 0; n < 6; n++) sampler.sample();
    const kept = sampler.history();
    expect(kept).toHaveLength(4);
    expect(kept.map((s) => s.at)).toEqual([1_006_000, 1_008_000, 1_010_000, 1_012_000]);
  });

  test("history is a copy the caller cannot reach into the ring through", () => {
    const { sampler } = scripted([[core(0, 0)], [core(1, 1)]]);
    sampler.baseline();
    sampler.sample();
    sampler.history().length = 0;
    expect(sampler.history()).toHaveLength(1);
  });

  test("the history message names the interval and the window", () => {
    const { sampler } = scripted([[core(0, 0)], [core(1, 1)]]);
    sampler.baseline();
    sampler.sample();
    const message = sampler.historyMessage();
    expect(message.type).toBe("loadHistory");
    expect(message.capacity).toBe(4);
    expect(message.intervalMs).toBe(2_000);
    expect(message.samples).toHaveLength(1);
  });
});

describe("start and stop", () => {
  test("start baselines at once and samples on the interval; stop ends it", async () => {
    let n = 0;
    const sampler = new LoadSampler({
      cpus: () => [core(n * 5, n++ * 5)],
      loadavg: () => [0, 0, 0],
    });
    sampler.start(20);
    expect(sampler.running).toBe(true);
    // The baseline, taken synchronously, records nothing.
    expect(n).toBe(1);
    expect(sampler.history()).toEqual([]);
    expect(await waitFor(() => sampler.history().length >= 2, 2000)).toBe(true);
    expect(sampler.historyMessage().intervalMs).toBe(20);

    sampler.stop();
    expect(sampler.running).toBe(false);
    const stopped = sampler.history().length;
    await Bun.sleep(80);
    expect(sampler.history().length).toBe(stopped);
  });

  test("a listener hears each sample until it unsubscribes", () => {
    const { sampler } = scripted([[core(0, 0)], [core(1, 1)], [core(2, 2)]]);
    const heard: number[] = [];
    const off = sampler.subscribe((s) => heard.push(s.at));
    sampler.baseline();
    sampler.sample();
    off();
    sampler.sample();
    expect(heard).toEqual([1_002_000]);
  });
});

describe("on this machine", () => {
  test("os.cpus() and os.loadavg() give a sane figure between two readings", async () => {
    const sampler = new LoadSampler();
    sampler.baseline();
    await Bun.sleep(50);
    const sample = sampler.sample()!;
    expect(sample.cores).toBe(os.cpus().length);
    expect(sample.cores).toBeGreaterThan(0);
    // Null only if the kernel's counters did not move in 50ms, which on a
    // machine running this test suite they do.
    if (sample.cpu !== null) {
      expect(sample.cpu).toBeGreaterThanOrEqual(0);
      expect(sample.cpu).toBeLessThanOrEqual(100);
    }
    for (const avg of sample.load) expect(avg).toBeGreaterThanOrEqual(0);
  });
});

// Over a real Bun.serve with the real task manager's broadcast, wired the way
// `server.ts` wires them: history on open, every tick through `broadcastToAll`.
describe("over the terminal socket", () => {
  let server: Server<WebSocketData> | undefined;
  const clients: WebSocket[] = [];

  afterEach(() => {
    for (const c of clients) c.close();
    clients.length = 0;
    server?.stop(true);
    server = undefined;
  });

  function start(sampler: LoadSampler) {
    const db = new Database(":memory:");
    applyMigrations(db);
    const manager = new TaskManager(db);
    streamLoad(sampler, (message) => manager.broadcastToAll(message));
    let n = 0;
    server = Bun.serve<WebSocketData>({
      port: 0,
      fetch(req, srv) {
        if (srv.upgrade(req, { data: { clientId: `c${++n}` } })) return;
        return new Response("upgrade failed", { status: 400 });
      },
      websocket: {
        perMessageDeflate: terminalSocketCompression,
        open(ws) {
          manager.registerClient(ws.data.clientId, ws);
          sendLoadHistory(sampler, ws);
        },
        message() {},
        close(ws) {
          manager.unregisterClient(ws.data.clientId);
        },
      },
    });
    return server;
  }

  async function connect(port: number) {
    const received: ServerMessage[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/terminal`);
    clients.push(ws);
    ws.onmessage = (e) => received.push(JSON.parse(String(e.data)));
    expect(await waitFor(() => ws.readyState === WebSocket.OPEN)).toBe(true);
    return received;
  }

  test("a client is handed the history as it connects, then every tick", async () => {
    const { sampler } = scripted([[core(0, 0)], [core(1, 1)], [core(3, 1)], [core(4, 4)]]);
    sampler.baseline();
    sampler.sample();
    sampler.sample();
    const srv = start(sampler);

    const received = await connect(srv.port!);
    expect(await waitFor(() => received.length >= 1)).toBe(true);
    const [history] = received;
    expect(history?.type).toBe("loadHistory");
    if (history?.type !== "loadHistory") throw new Error("unreachable");
    expect(history.samples.map((s) => s.cpu)).toEqual([50, 100]);

    sampler.sample();
    expect(await waitFor(() => received.length >= 2)).toBe(true);
    expect(received[1]).toEqual({ type: "load", sample: sampler.history().at(-1)! });
  });

  test("a tick reads the machine once however many clients are connected", async () => {
    const { sampler, reads } = scripted([[core(0, 0)], [core(1, 1)], [core(2, 2)]]);
    sampler.baseline();
    const srv = start(sampler);
    const a = await connect(srv.port!);
    const b = await connect(srv.port!);
    const c = await connect(srv.port!);
    expect(await waitFor(() => a.length + b.length + c.length === 3)).toBe(true);

    const before = reads();
    sampler.sample();
    expect(reads()).toBe(before + 1);
    expect(await waitFor(() => [a, b, c].every((r) => r.some((m) => m.type === "load")))).toBe(true);
  });
});
