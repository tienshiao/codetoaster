import { test, expect } from "bun:test";
import { ago, agoLabel, absoluteTime } from "./taskTimes";

const NOW = Date.UTC(2026, 8, 7, 12, 0, 0);
const s = 1000;
const m = 60 * s;
const h = 60 * m;
const d = 24 * h;

test("the row's age is one coarse unit", () => {
  expect(ago(NOW, NOW)).toBe("0s");
  expect(ago(NOW - 47 * s, NOW)).toBe("47s");
  expect(ago(NOW - 3 * m, NOW)).toBe("3m");
  expect(ago(NOW - 5 * h, NOW)).toBe("5h");
  expect(ago(NOW - 6 * d, NOW)).toBe("6d");
});

test("a unit is used up to its own boundary, not past it", () => {
  // 59s stays seconds; 90s is a minute and a half and rounds to the nearer
  // minute rather than truncating to one.
  expect(ago(NOW - 59 * s, NOW)).toBe("59s");
  expect(ago(NOW - 90 * s, NOW)).toBe("2m");
  expect(ago(NOW - 59 * m, NOW)).toBe("59m");
  expect(ago(NOW - 23 * h, NOW)).toBe("23h");
  expect(ago(NOW - 30 * d, NOW)).toBe("30d");
});

test("a timestamp from the future is clamped to now rather than counting up", () => {
  // Clocks disagree — the daemon's and the browser's — and a row reading
  // "-4s" would be reporting that disagreement instead of the task's age.
  expect(ago(NOW + 10 * m, NOW)).toBe("0s");
  expect(agoLabel(NOW + 10 * m, NOW)).toBe("just now");
});

test("the card's age is the same measurement as a phrase", () => {
  expect(agoLabel(NOW - 3 * m, NOW)).toBe("3m ago");
  expect(agoLabel(NOW - 6 * d, NOW)).toBe("6d ago");
  expect(agoLabel(NOW - 47 * s, NOW)).toBe("47s ago");
});

test("the last few seconds are 'just now', not a digit pretending to be a measurement", () => {
  expect(agoLabel(NOW, NOW)).toBe("just now");
  expect(agoLabel(NOW - 4 * s, NOW)).toBe("just now");
  expect(agoLabel(NOW - 5 * s, NOW)).toBe("5s ago");
});

test("the absolute reading carries both the date and the time of day", () => {
  const written = absoluteTime(NOW);
  // Locale and zone are the machine's, so what is asserted is that the two
  // halves are both there — a date without a time answers "which Tuesday" and
  // not "was that before or after lunch".
  expect(written).toBe(
    new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(NOW),
    ),
  );
  expect(written).toContain("2026");
  expect(written).toMatch(/\d{1,2}:\d{2}/);
});

test("repeated calls reuse one formatter and still say the same thing", () => {
  expect(absoluteTime(NOW)).toBe(absoluteTime(NOW));
  expect(absoluteTime(NOW - 400 * d)).not.toBe(absoluteTime(NOW));
});
