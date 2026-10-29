import { countDescriptors, jsHeap, type MemorySampler } from "../lib/diagnostics";

/**
 * `GET /api/diagnostics` (TASK-134): the daemon's memory, descriptors and the
 * sizes of what it holds, for `codetoaster status` and for whoever is asking
 * why it is big.
 *
 * `?heap=1` adds the JS heap's object counts by type. It is opt-in because it
 * walks the heap's type table on the event loop, which on a daemon with a heap
 * of gigabytes is a pause every terminal feels, and `status` does not print it.
 */

export interface DiagnosticsSource {
  sampler: MemorySampler;
  /** What the daemon is holding: PTYs, clients, watch streams, caches. */
  counts: () => Record<string, number>;
  startedAt: number;
  now?: () => number;
}

export function collectDiagnostics(source: DiagnosticsSource, options: { heap?: boolean } = {}) {
  const now = source.now ?? Date.now;
  // A sample of its own, so the peak and the thresholds are current to the
  // request rather than to the last tick.
  const memory = source.sampler.sample();
  const peak = source.sampler.peak();
  return {
    bun: Bun.version,
    pid: process.pid,
    uptime: Math.floor((now() - source.startedAt) / 1000),
    memory: {
      ...memory,
      sampledPeak: peak ? { bytes: peak.bytes, at: new Date(peak.at).toISOString() } : null,
    },
    jsHeap: options.heap ? jsHeap() : null,
    descriptors: countDescriptors(),
    counts: source.counts(),
  };
}

export type Diagnostics = ReturnType<typeof collectDiagnostics>;

export function diagnosticsRoutes(source: DiagnosticsSource) {
  return {
    "/api/diagnostics": {
      GET(req: Request) {
        const heap = new URL(req.url).searchParams.get("heap") === "1";
        return Response.json(collectDiagnostics(source, { heap }));
      },
    },
  };
}
