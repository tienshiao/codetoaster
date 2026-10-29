import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { diagnosticsRoutes, type Diagnostics } from "./diagnostics";
import { MemorySampler, type MemoryReading } from "../lib/diagnostics";

// Through a real Bun.serve, so the body is what `codetoaster status` gets.
let server: ReturnType<typeof Bun.serve>;
const lines: string[] = [];
const startedAt = Date.UTC(2026, 9, 29, 9, 0, 0);
const now = Date.UTC(2026, 9, 29, 10, 0, 0);

const GB = 2 ** 30;
const reading: MemoryReading = {
  footprint: 3 * GB,
  lifetimeMaxFootprint: 5 * GB,
  rss: 200 * 2 ** 20,
  heapUsed: 50 * 2 ** 20,
  heapTotal: 80 * 2 ** 20,
  external: 0,
  arrayBuffers: 0,
};

beforeAll(() => {
  const sampler = new MemorySampler({ read: () => reading, now: () => now, log: (l) => lines.push(l) });
  const routes = diagnosticsRoutes({
    sampler,
    startedAt,
    now: () => now,
    counts: () => ({ ptys: 3, clients: 1, watchStreams: 6 }),
  });
  server = Bun.serve({ port: 0, routes, fetch: () => new Response("", { status: 404 }) });
});

afterAll(() => {
  server.stop(true);
});

describe("GET /api/diagnostics", () => {
  test("reports memory, the sampled peak, descriptors and counts", async () => {
    const res = await fetch(`http://localhost:${server.port}/api/diagnostics`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Diagnostics;

    expect(body.bun).toBe(Bun.version);
    expect(body.pid).toBe(process.pid);
    expect(body.uptime).toBe(3600);
    expect(body.memory.footprint).toBe(3 * GB);
    expect(body.memory.lifetimeMaxFootprint).toBe(5 * GB);
    expect(body.memory.sampledPeak).toEqual({ bytes: 3 * GB, at: "2026-10-29T10:00:00.000Z" });
    expect(body.counts).toEqual({ ptys: 3, clients: 1, watchStreams: 6 });
    // The real process's, since descriptors and the heap are not injected.
    expect(body.descriptors!.total).toBeGreaterThan(0);
    expect(body.descriptors!.socket).toBeGreaterThan(0);
    // The heap walk is opt-in.
    expect(body.jsHeap).toBeNull();
  });

  test("heap=1 adds the JS heap's object counts by type", async () => {
    const res = await fetch(`http://localhost:${server.port}/api/diagnostics?heap=1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Diagnostics;
    expect(body.jsHeap!.objects).toBeGreaterThan(0);
    expect(body.jsHeap!.topTypes.length).toBeGreaterThan(0);
  });

  test("a request samples, so crossing a threshold is logged from it too", async () => {
    // Its own request, so the test holds when run alone; a repeat crossing is
    // not logged twice, so after the one above this adds nothing.
    await fetch(`http://localhost:${server.port}/api/diagnostics`);
    expect(lines.some((l) => l.includes("passed 2 GB"))).toBe(true);
  });

  test("anything but GET is not served", async () => {
    const res = await fetch(`http://localhost:${server.port}/api/diagnostics`, { method: "POST" });
    expect(res.status).not.toBe(200);
  });
});
