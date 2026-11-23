import * as os from "os";
import { sendFrame, type FrameSink } from "./xtmux/socket";
import type { LoadHistoryMessage, LoadSample, LoadSampleMessage } from "./xtmux/types";

export type { LoadSample } from "./xtmux/types";

/**
 * How hard the machine the daemon runs on is working (TASK-149).
 *
 * Machine-wide, not the daemon: the daemon is one process among the agents,
 * builds and test runs it spawned, and what the user wants at a glance is the
 * Activity Monitor graph — is this box busy, and has it been. So the figure is
 * the share of all cores' time that was not idle between two readings of
 * `os.cpus()`, beside `os.loadavg()`.
 *
 * Kept apart from `MemorySampler` (TASK-134), which watches the daemon's own
 * footprint for the log. The two share a shape — start, stop, an injected
 * clock — and nothing else.
 *
 * One sampler for the daemon, on a fixed tick whatever the number of clients,
 * running from boot so a page loaded at any time is handed the last ten minutes
 * rather than starting from an empty chart. A tick is two cheap calls (about
 * 2µs and 1µs under Bun on macOS) and one slot in a fixed ring.
 */

/** Two seconds: fine enough that a build starting shows within a breath, and
 * coarse enough that the per-client cost — one small frame — is nothing. */
export const LOAD_INTERVAL_MS = 2_000;
/** Ten minutes at that interval: the window the card charts. */
export const LOAD_CAPACITY = 300;

/** The part of `os.cpus()` the sampler reads. */
export interface CpuTimes {
  times: { user: number; nice: number; sys: number; idle: number; irq: number };
}

export interface LoadSamplerOptions {
  cpus?: () => CpuTimes[];
  loadavg?: () => number[];
  now?: () => number;
  capacity?: number;
}

interface Totals {
  busy: number;
  total: number;
  cores: number;
}

function totals(cpus: CpuTimes[]): Totals {
  let busy = 0;
  let total = 0;
  for (const { times } of cpus) {
    const all = times.user + times.nice + times.sys + times.idle + times.irq;
    total += all;
    busy += all - times.idle;
  }
  return { busy, total, cores: cpus.length };
}

const round = (n: number, places: number) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

export class LoadSampler {
  private readonly cpus: () => CpuTimes[];
  private readonly loadavg: () => number[];
  private readonly now: () => number;
  readonly capacity: number;
  /** A fixed ring: `next` is where the next sample goes, `size` how many of
   * the slots hold one. */
  private readonly ring: (LoadSample | undefined)[];
  private next = 0;
  private size = 0;
  private previous: Totals | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private intervalMs = LOAD_INTERVAL_MS;
  private readonly listeners = new Set<(sample: LoadSample) => void>();

  constructor(options: LoadSamplerOptions = {}) {
    this.cpus = options.cpus ?? os.cpus;
    this.loadavg = options.loadavg ?? os.loadavg;
    this.now = options.now ?? Date.now;
    this.capacity = Math.max(1, options.capacity ?? LOAD_CAPACITY);
    this.ring = new Array(this.capacity);
  }

  /** Read the counters without recording anything: the first reading has
   * nothing to be a delta against. */
  baseline(): void {
    this.previous = totals(this.cpus());
  }

  /**
   * Take one sample, keep it, and hand it to every listener.
   *
   * Without a baseline this only takes one and answers null. The counters are
   * cumulative since boot, and a first figure computed from them would be the
   * average over the machine's whole uptime — a number that looks live and is
   * nothing of the kind.
   */
  sample(): LoadSample | null {
    const current = totals(this.cpus());
    const previous = this.previous;
    this.previous = current;
    if (!previous) return null;

    const dTotal = current.total - previous.total;
    const dBusy = current.busy - previous.busy;
    // A core coming or going changes what the sums are sums of, and a counter
    // that wrapped runs backwards. Either way this interval says nothing, and
    // the next one is measured from the reading just taken.
    const usable =
      current.cores === previous.cores && dTotal > 0 && dBusy >= 0 && dBusy <= dTotal;
    const [one = 0, five = 0, fifteen = 0] = this.loadavg();
    const sample: LoadSample = {
      at: this.now(),
      cpu: usable ? round((dBusy / dTotal) * 100, 1) : null,
      load: [round(one, 2), round(five, 2), round(fifteen, 2)],
      cores: current.cores,
    };
    this.ring[this.next] = sample;
    this.next = (this.next + 1) % this.capacity;
    this.size = Math.min(this.size + 1, this.capacity);
    for (const listener of [...this.listeners]) listener(sample);
    return sample;
  }

  /** The kept samples, oldest first. A copy: the ring is reused in place. */
  history(): LoadSample[] {
    const out: LoadSample[] = [];
    const start = (this.next - this.size + this.capacity) % this.capacity;
    for (let i = 0; i < this.size; i++) out.push(this.ring[(start + i) % this.capacity]!);
    return out;
  }

  historyMessage(): LoadHistoryMessage {
    return {
      type: "loadHistory",
      intervalMs: this.intervalMs,
      capacity: this.capacity,
      samples: this.history(),
    };
  }

  /** Called with every sample as it is taken. Returns the unsubscribe. */
  subscribe(listener: (sample: LoadSample) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Baselines now and samples every `intervalMs`, without holding the
   * process open. */
  start(intervalMs = LOAD_INTERVAL_MS): void {
    this.stop();
    this.intervalMs = intervalMs;
    this.baseline();
    this.timer = setInterval(() => this.sample(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get running(): boolean {
    return this.timer !== null;
  }
}

/** The history, to one socket that has just opened — so the card has the
 * last ten minutes the first time it is opened after a page load. */
export function sendLoadHistory(sampler: LoadSampler, ws: FrameSink): void {
  sendFrame(ws, JSON.stringify(sampler.historyMessage()));
}

/** Every sample, to every client, through `broadcast` — which serializes once
 * and sends the same string to each socket, so a client costs its frame and
 * nothing more. Returns the unsubscribe. */
export function streamLoad(
  sampler: LoadSampler,
  broadcast: (message: LoadSampleMessage) => void,
): () => void {
  return sampler.subscribe((sample) => broadcast({ type: "load", sample }));
}
