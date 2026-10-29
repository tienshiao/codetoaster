import { test, expect, describe } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  MemorySampler,
  countDescriptors,
  formatBytes,
  processFootprint,
  readMemory,
  type MemoryReading,
} from "./diagnostics";

const MB = 2 ** 20;
const GB = 2 ** 30;

function reading(footprint: number | null, rss = 100 * MB): MemoryReading {
  return {
    footprint,
    lifetimeMaxFootprint: footprint,
    rss,
    heapUsed: 10 * MB,
    heapTotal: 20 * MB,
    external: 0,
    arrayBuffers: 0,
  };
}

/** A sampler fed a script of readings, on a clock that moves a minute a sample. */
function scripted(readings: MemoryReading[]) {
  const lines: string[] = [];
  let t = Date.UTC(2026, 9, 29, 10, 0, 0);
  let i = 0;
  const sampler = new MemorySampler({
    read: () => readings[Math.min(i++, readings.length - 1)]!,
    now: () => (t += 60_000),
    log: (line) => lines.push(line),
  });
  return { sampler, lines };
}

describe("MemorySampler", () => {
  test("nothing is logged below the first threshold", () => {
    const { sampler, lines } = scripted([reading(200 * MB), reading(900 * MB)]);
    sampler.sample();
    sampler.sample();
    expect(lines).toEqual([]);
  });

  test("each doubling is logged the first time it is crossed, and only then", () => {
    const { sampler, lines } = scripted([
      reading(1.2 * GB),
      reading(1.5 * GB),
      reading(0.8 * GB),
      reading(1.3 * GB),
      reading(2.5 * GB),
    ]);
    for (let i = 0; i < 5; i++) sampler.sample();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("passed 1 GB");
    expect(lines[0]).toContain("2026-10-29T10:01:00.000Z");
    expect(lines[1]).toContain("passed 2 GB");
    expect(lines[1]).toContain("2026-10-29T10:05:00.000Z");
  });

  test("a jump over several thresholds is one line, naming the highest", () => {
    const { sampler, lines } = scripted([reading(5 * GB), reading(6 * GB), reading(8.5 * GB)]);
    sampler.sample();
    sampler.sample();
    sampler.sample();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("passed 4 GB");
    expect(lines[1]).toContain("passed 8 GB");
  });

  test("the peak is the largest footprint sampled, with when", () => {
    const { sampler } = scripted([reading(300 * MB), reading(700 * MB), reading(400 * MB)]);
    expect(sampler.peak()).toBeNull();
    sampler.sample();
    sampler.sample();
    sampler.sample();
    expect(sampler.peak()).toEqual({ bytes: 700 * MB, at: Date.UTC(2026, 9, 29, 10, 2, 0) });
  });

  test("without a footprint the resident size stands in", () => {
    const { sampler, lines } = scripted([reading(null, 1.1 * GB)]);
    sampler.sample();
    expect(sampler.peak()?.bytes).toBe(1.1 * GB);
    expect(lines[0]).toContain("resident size passed 1 GB");
  });

  test("start samples at once and on the interval; stop ends it", async () => {
    let reads = 0;
    const sampler = new MemorySampler({
      read: () => {
        reads++;
        return reading(10 * MB);
      },
      log: () => {},
    });
    sampler.start(20);
    expect(reads).toBe(1);
    await Bun.sleep(70);
    sampler.stop();
    const after = reads;
    expect(after).toBeGreaterThan(1);
    await Bun.sleep(50);
    expect(reads).toBe(after);
  });
});

describe("readings", () => {
  test.if(process.platform === "darwin")("the footprint is the process's own, and the lifetime peak bounds it", () => {
    const fp = processFootprint();
    expect(fp).not.toBeNull();
    expect(fp!.footprint).toBeGreaterThan(MB);
    expect(fp!.lifetimeMax).toBeGreaterThanOrEqual(fp!.footprint);
    // Swapped-out pages count toward the footprint and not toward RSS, so the
    // two need not agree; the footprint of a test runner is still far below
    // anything absurd, which is what a wrong struct offset would produce.
    expect(fp!.footprint).toBeLessThan(64 * GB);
  });

  test.if(process.platform === "darwin")("the resident size is the one ps reports, not the footprint", () => {
    // Allocated and touched, so resident moves well clear of any noise.
    const held = new Uint8Array(200 * MB).fill(1);
    const ps = Number(Bun.spawnSync(["ps", "-o", "rss=", "-p", String(process.pid)]).stdout.toString()) * 1024;
    const r = readMemory();
    expect(Math.abs(r.rss - ps) / ps).toBeLessThan(0.2);
    // In a fresh process nothing is swapped, so footprint and resident are
    // close and the comparison above cannot tell them apart; what can is that
    // the figure is the kernel's resident size and not Bun's `rss`, which is
    // the footprint. Read back to back, they agree to within the page or two
    // the read itself moves.
    const fp = processFootprint()!;
    expect(Math.abs(r.rss - fp.resident)).toBeLessThan(4 * MB);
    expect(held.length).toBe(200 * MB);
  });

  test("readMemory carries the runtime's own numbers", () => {
    const r = readMemory();
    expect(r.rss).toBeGreaterThan(0);
    expect(r.heapUsed).toBeGreaterThan(0);
    if (process.platform === "darwin") expect(r.footprint).toBeGreaterThan(0);
  });

  test("an open directory is counted among the descriptors as one", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-fds-"));
    try {
      const before = countDescriptors()!;
      const fd = fs.openSync(dir, "r");
      try {
        const during = countDescriptors()!;
        expect(during.directory).toBe((before.directory ?? 0) + 1);
        expect(during.total).toBe(before.total + 1);
      } finally {
        fs.closeSync(fd);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("formatBytes", () => {
  test("binary units, one decimal past a gigabyte", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(240 * MB)).toBe("240 MB");
    expect(formatBytes(7.9 * GB)).toBe("7.9 GB");
    expect(formatBytes(13 * GB)).toBe("13.0 GB");
    expect(formatBytes(GB - 100 * 1024)).toBe("1.0 GB");
    expect(formatBytes(2 ** 20 - 100)).toBe("1 MB");
  });
});
