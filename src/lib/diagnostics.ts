import * as fs from "fs";
import { heapStats } from "bun:jsc";

/**
 * What the daemon can say about its own memory and descriptors (TASK-134).
 *
 * The number that matters on macOS is the physical footprint, not RSS: a
 * daemon left running for days had a 7.9 GB footprint and a 13 GB peak while
 * its RSS read 240 MB, because almost all of it had been swapped out. Nothing
 * the daemon reported could show that, or say when it had happened, so the
 * next one would have been as unattributable as that one. The footprint comes
 * from `proc_pid_rusage` — one syscall, no `footprint` or `vmmap` subprocess —
 * so it is cheap enough to sample every minute for the life of the process,
 * and the sampler leaves a line in the log the first time each doubling is
 * crossed, which is what ties a spike to the time it happened.
 */

export interface MemoryReading {
  /** Physical footprint: resident plus compressed and swapped dirty memory.
   * What Activity Monitor calls Memory. Null where the platform has no such
   * figure. */
  footprint: number | null;
  /** The kernel's own high-water mark for the footprint over the process's
   * life, which a minute-by-minute sampler can miss the top of. */
  lifetimeMaxFootprint: number | null;
  /** Resident size: what `ps` and `top` call RSS. Not
   * `process.memoryUsage().rss`, which on macOS is the footprint again (Bun
   * reads `phys_footprint` for it: 305 MB against a resident 314 MB in a
   * process holding 300 MB), so the two would always agree there and say
   * nothing between them. */
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
}

// `struct rusage_info_v4` from <sys/resource.h>: a 16-byte uuid followed by
// uint64 fields. `ri_resident_size` is the seventh of them,
// `ri_phys_footprint` the eighth and `ri_lifetime_max_phys_footprint` the
// twenty-ninth. Checked against `footprint(1)` on a live daemon (8008 MB /
// 13267 MB against its 8010 MB / 13 GB) and against `ps` when this was written.
const RUSAGE_INFO_V4 = 4;
const RESIDENT_SIZE = 64;
const PHYS_FOOTPRINT = 72;
const LIFETIME_MAX_PHYS_FOOTPRINT = 240;

type Rusage = (pid: number, flavor: number, buffer: BigUint64Array) => number;
let rusage: Rusage | null | undefined;

function loadRusage(): Rusage | null {
  if (rusage !== undefined) return rusage;
  rusage = null;
  if (process.platform !== "darwin") return rusage;
  try {
    // Required lazily: this module is imported by the server on every
    // platform, and only macOS has the symbol.
    const { dlopen, ptr } = require("bun:ffi") as typeof import("bun:ffi");
    const lib = dlopen("/usr/lib/libSystem.B.dylib", {
      proc_pid_rusage: { args: ["i32", "i32", "ptr"], returns: "i32" },
    });
    rusage = (pid, flavor, buffer) => lib.symbols.proc_pid_rusage(pid, flavor, ptr(buffer)) as number;
  } catch {
    // No FFI, or no symbol: the footprint is simply unknown.
  }
  return rusage;
}

export interface ProcessFootprint {
  footprint: number;
  lifetimeMax: number;
  resident: number;
}

/** This process's physical footprint, its lifetime peak and its resident
 * size, in bytes. */
export function processFootprint(): ProcessFootprint | null {
  if (process.platform === "linux") return linuxFootprint();
  const call = loadRusage();
  if (!call) return null;
  // Larger than the struct, so a kernel that writes a longer one cannot
  // overrun it.
  const buffer = new BigUint64Array(64);
  if (call(process.pid, RUSAGE_INFO_V4, buffer) !== 0) return null;
  return {
    footprint: Number(buffer[PHYS_FOOTPRINT / 8]),
    lifetimeMax: Number(buffer[LIFETIME_MAX_PHYS_FOOTPRINT / 8]),
    resident: Number(buffer[RESIDENT_SIZE / 8]),
  };
}

/** Linux has no footprint as such; resident plus swapped is the same idea,
 * and the resident high-water mark is the nearest thing to its peak. */
function linuxFootprint(): ProcessFootprint | null {
  try {
    const status = fs.readFileSync("/proc/self/status", "utf8");
    const kb = (field: string) => Number(status.match(new RegExp(`^${field}:\\s+(\\d+) kB`, "m"))?.[1] ?? 0) * 1024;
    const resident = kb("VmRSS");
    const footprint = resident + kb("VmSwap");
    return { footprint, lifetimeMax: Math.max(footprint, kb("VmHWM")), resident };
  } catch {
    return null;
  }
}

export function readMemory(): MemoryReading {
  const usage = process.memoryUsage();
  const fp = processFootprint();
  return {
    footprint: fp?.footprint ?? null,
    lifetimeMaxFootprint: fp?.lifetimeMax ?? null,
    rss: fp?.resident ?? usage.rss,
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers,
  };
}

export type DescriptorKind = "file" | "directory" | "socket" | "pipe" | "character" | "other";

/**
 * Open descriptors by kind, from `/dev/fd` (on Linux a link to
 * `/proc/self/fd`). A `stat` each, so it is for a request, not for the
 * sampler. The descriptor the listing itself used is gone by the time it is
 * stat'ed and is skipped with anything else that closed in between. Null
 * where there is no `/dev/fd` to read, which is unknown, not none.
 */
export function countDescriptors(): ({ total: number } & Partial<Record<DescriptorKind, number>>) | null {
  const counts: { total: number } & Partial<Record<DescriptorKind, number>> = { total: 0 };
  let entries: string[];
  try {
    entries = fs.readdirSync("/dev/fd");
  } catch {
    return null;
  }
  for (const entry of entries) {
    let kind: DescriptorKind;
    try {
      const stat = fs.fstatSync(Number(entry));
      kind = stat.isFile()
        ? "file"
        : stat.isDirectory()
          ? "directory"
          : stat.isSocket()
            ? "socket"
            : stat.isFIFO()
              ? "pipe"
              : stat.isCharacterDevice()
                ? "character"
                : "other";
    } catch {
      continue;
    }
    counts[kind] = (counts[kind] ?? 0) + 1;
    counts.total++;
  }
  return counts;
}

/** The JS heap as JavaScriptCore counts it, with the most numerous object
 * types: what a leak of JS objects shows up in. Walks the heap's type table,
 * so it is for a request, not for the sampler. */
export function jsHeap(top = 15) {
  const stats = heapStats();
  return {
    size: stats.heapSize,
    capacity: stats.heapCapacity,
    extraMemory: stats.extraMemorySize,
    objects: stats.objectCount,
    topTypes: Object.entries(stats.objectTypeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, top)
      .map(([type, count]) => ({ type, count })),
  };
}

const GB = 2 ** 30;

export interface MemorySamplerOptions {
  read?: () => MemoryReading;
  now?: () => number;
  log?: (line: string) => void;
  /** The first footprint worth a log line; each doubling after it is the
   * next. */
  firstThreshold?: number;
}

/**
 * Samples the footprint on an interval, remembers the largest it has seen and
 * when, and logs one line the first time each threshold — 1, 2, 4, 8 GB — is
 * crossed. The log line is the point: the daemon's log is what is still there
 * after the fact, and a timestamp is what lets a spike be laid against what the
 * user was doing.
 */
export class MemorySampler {
  private readonly read: () => MemoryReading;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private nextThreshold: number;
  private top: { bytes: number; at: number } | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: MemorySamplerOptions = {}) {
    this.read = options.read ?? readMemory;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? ((line) => console.log(line));
    // Positive, or the doubling in `sample` never moves off zero.
    this.nextThreshold = Math.max(1, options.firstThreshold ?? GB);
  }

  sample(): MemoryReading {
    const reading = this.read();
    const at = this.now();
    const bytes = reading.footprint ?? reading.rss;
    if (!this.top || bytes > this.top.bytes) this.top = { bytes, at };
    if (bytes >= this.nextThreshold) {
      let crossed = this.nextThreshold;
      while (bytes >= crossed * 2) crossed *= 2;
      this.nextThreshold = crossed * 2;
      const what = reading.footprint === null ? "resident size" : "footprint";
      this.log(
        `Memory: ${what} passed ${formatThreshold(crossed)} at ${new Date(at).toISOString()} ` +
          `(footprint ${reading.footprint === null ? "unknown" : formatBytes(reading.footprint)}, ` +
          `resident ${formatBytes(reading.rss)}, JS heap ${formatBytes(reading.heapUsed)})`,
      );
    }
    return reading;
  }

  /** The largest footprint sampled so far, and when. */
  peak(): { bytes: number; at: number } | null {
    return this.top;
  }

  /** Samples now and then every `intervalMs`, without holding the process
   * open. */
  start(intervalMs: number): void {
    this.stop();
    this.sample();
    this.timer = setInterval(() => this.sample(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

/** A threshold reads as the round number it is: "2 GB", not "2.0 GB". The
 * default ones are whole gigabytes; a smaller first threshold falls back to
 * `formatBytes`. */
function formatThreshold(bytes: number): string {
  return Number.isInteger(bytes / GB) ? `${bytes / GB} GB` : formatBytes(bytes);
}

/** Bytes in binary units: whole numbers up to a gigabyte, one decimal past it. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  // On the rounded figure, so 1023.8 MB reads "1.0 GB" rather than "1024 MB".
  const kb = Math.round(bytes / 1024);
  if (kb < 1024) return `${kb} KB`;
  const mb = Math.round(bytes / 2 ** 20);
  if (mb < 1024) return `${mb} MB`;
  return `${(bytes / GB).toFixed(1)} GB`;
}
