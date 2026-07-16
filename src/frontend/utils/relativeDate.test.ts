import { test, expect } from "bun:test";
import { relativeDate } from "./relativeDate";

// Fixed reference "now" (ms). Ages are expressed relative to it so the tests
// are deterministic regardless of the real clock.
const NOW = 1_700_000_000_000;
const DAY = 86_400;

// Build a unix-seconds timestamp `ageSeconds` in the past relative to NOW.
function ago(ageSeconds: number): number {
  return NOW / 1000 - ageSeconds;
}

function at(ageSeconds: number): string {
  return relativeDate(ago(ageSeconds), NOW);
}

// --- seconds / "just now" boundary (cutoff 60 = minutes divisor) ------------

test("44s ago → just now", () => {
  expect(at(44)).toBe("just now");
});

test("50s ago → just now (no 0m ago)", () => {
  expect(at(50)).toBe("just now");
});

test("59s ago → just now (no 0m ago)", () => {
  expect(at(59)).toBe("just now");
});

test("60s ago → 1m ago", () => {
  expect(at(60)).toBe("1m ago");
});

// --- months / years boundary (cutoff 365d = years divisor) ------------------

test("359d ago → 11mo ago", () => {
  expect(at(359 * DAY)).toBe("11mo ago");
});

test("361d ago → 12mo ago (no 0y ago)", () => {
  expect(at(361 * DAY)).toBe("12mo ago");
});

test("364d ago → 12mo ago (no 0y ago)", () => {
  expect(at(364 * DAY)).toBe("12mo ago");
});

test("365d ago → 1y ago", () => {
  expect(at(365 * DAY)).toBe("1y ago");
});

// --- one normal case per bucket ---------------------------------------------

test("normal cases per bucket", () => {
  expect(at(10)).toBe("just now");
  expect(at(5 * 60)).toBe("5m ago");
  expect(at(3 * 3600)).toBe("3h ago");
  expect(at(2 * DAY)).toBe("2d ago");
  expect(at(120 * DAY)).toBe("4mo ago");
  expect(at(730 * DAY)).toBe("2y ago");
});

test("future timestamps clamp to just now", () => {
  expect(relativeDate(NOW / 1000 + 500, NOW)).toBe("just now");
});
