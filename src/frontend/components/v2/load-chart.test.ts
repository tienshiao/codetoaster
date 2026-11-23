import { test, expect, describe } from "bun:test";
import { cpuLabel, isHighLoad, loadPaths, windowLabel, type PlotBox } from "./load-chart";

const box: PlotBox = { width: 100, height: 50, start: 0, end: 100, maxGapMs: 25 };

describe("loadPaths", () => {
  test("maps time across and 0–100% up a fixed scale", () => {
    const { lines, areas, last } = loadPaths(
      [
        { at: 0, cpu: 0 },
        { at: 50, cpu: 50 },
        { at: 100, cpu: 100 },
      ],
      // A gap allowance wide enough that the 50ms steps here are one run.
      { ...box, maxGapMs: 60 },
    );
    expect(lines).toEqual(["M0,50 L50,25 L100,0"]);
    expect(areas).toEqual(["M0,50 L0,50 L50,25 L100,0 L100,50 Z"]);
    expect(last).toEqual({ x: 100, y: 0 });
  });

  test("a null breaks the line, and so does a gap past the allowance", () => {
    const { lines } = loadPaths(
      [
        { at: 0, cpu: 10 },
        { at: 20, cpu: 10 },
        { at: 40, cpu: null },
        { at: 60, cpu: 10 },
        { at: 80, cpu: 10 },
        { at: 100, cpu: 10 },
      ],
      { ...box, maxGapMs: 25 },
    );
    expect(lines).toEqual(["M0,45 L20,45", "M60,45 L80,45 L100,45"]);

    const slept = loadPaths(
      [
        { at: 0, cpu: 10 },
        { at: 20, cpu: 10 },
        { at: 70, cpu: 10 },
        { at: 90, cpu: 10 },
      ],
      box,
    );
    expect(slept.lines).toEqual(["M0,45 L20,45", "M70,45 L90,45"]);
  });

  test("points before the window are left out", () => {
    const { lines } = loadPaths(
      [
        { at: -40, cpu: 90 },
        { at: 80, cpu: 10 },
        { at: 100, cpu: 10 },
      ],
      box,
    );
    expect(lines).toEqual(["M80,45 L100,45"]);
  });

  test("a lone point draws no line but is still the newest", () => {
    const { lines, last } = loadPaths([{ at: 100, cpu: 20 }], box);
    expect(lines).toEqual([]);
    expect(last).toEqual({ x: 100, y: 40 });
  });

  test("no end dot when the newest interval was not measured", () => {
    const { last } = loadPaths(
      [
        { at: 80, cpu: 10 },
        { at: 100, cpu: null },
      ],
      box,
    );
    expect(last).toBeNull();
  });

  test("an out-of-range reading is clamped to the frame", () => {
    const { last } = loadPaths([{ at: 100, cpu: 140 }], box);
    expect(last).toEqual({ x: 100, y: 0 });
  });
});

test("high load starts at 80%", () => {
  expect(isHighLoad(79.9)).toBe(false);
  expect(isHighLoad(80)).toBe(true);
  expect(isHighLoad(null)).toBe(false);
});

test("labels", () => {
  expect(windowLabel(600_000)).toBe("10 min");
  expect(windowLabel(90_000)).toBe("90 s");
  expect(cpuLabel(42.6)).toBe("43%");
  expect(cpuLabel(null)).toBe("–");
});
