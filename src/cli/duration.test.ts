import { test, expect, describe } from "bun:test";
import { parseDuration, formatDuration, resolveDuration } from "./duration";
import { daemonArgs } from "./daemon";

describe("parseDuration", () => {
  test("reads the three units", () => {
    expect(parseDuration("30m")).toBe(30 * 60_000);
    expect(parseDuration("2h")).toBe(2 * 60 * 60_000);
    expect(parseDuration("7d")).toBe(7 * 24 * 60 * 60_000);
  });

  test("0 is the one duration with no unit", () => {
    expect(parseDuration("0")).toBe(0);
    expect(parseDuration("  0  ")).toBe(0);
  });

  test("surrounding whitespace is not a typo worth failing over", () => {
    expect(parseDuration(" 45m\n")).toBe(45 * 60_000);
  });

  // Every one of these is a plausible thing to type, and every one of them
  // would mean something different from what the user meant if it were guessed
  // at rather than refused.
  for (const bad of ["", "1.5h", "90s", "10", "-1h", "5 m", "1H", "1h30m", "0m", "m", "1w"]) {
    test(`rejects ${JSON.stringify(bad)}`, () => {
      expect(() => parseDuration(bad)).toThrow(/expected a duration like 30m, 2h or 7d/);
    });
  }

  test("the message says what was given as well as what was wanted", () => {
    expect(() => parseDuration("90s")).toThrow(/got "90s"/);
  });

  // A number too big to be a number: `formatDuration` would print "Infinitym"
  // or exponent notation onto the child's argv, and the child would refuse it
  // in a log file rather than at the prompt where the user is standing.
  test("a duration too long to represent is refused here, not in the daemon's log", () => {
    expect(() => parseDuration("9".repeat(400) + "d")).toThrow(/too long/);
    expect(() => parseDuration("10000000000000000d")).toThrow(/too long/);
  });

  test("an absurd but representable duration is still a duration", () => {
    const ms = parseDuration("100000000d");
    expect(formatDuration(ms)).toBe("100000000d");
  });
});

describe("formatDuration", () => {
  test("the largest unit that divides exactly", () => {
    expect(formatDuration(30 * 60_000)).toBe("30m");
    expect(formatDuration(90 * 60_000)).toBe("90m");
    expect(formatDuration(2 * 60 * 60_000)).toBe("2h");
    expect(formatDuration(7 * 24 * 60 * 60_000)).toBe("7d");
  });

  test("nothing positive ever formats as the disabling 0", () => {
    expect(formatDuration(0)).toBe("0");
    expect(formatDuration(-1)).toBe("0");
    // Sub-minute: rounding down would say "disabled", which is a different
    // instruction entirely.
    expect(formatDuration(1)).toBe("1m");
  });

  // The round trip is the point: `spawnDaemon` prints the value onto the
  // foreground child's argv, which parses it again.
  test("round-trips every duration parseDuration accepts", () => {
    for (const text of ["0", "1m", "45m", "90m", "2h", "36h", "7d", "30d"]) {
      const ms = parseDuration(text);
      expect(parseDuration(formatDuration(ms))).toBe(ms);
    }
  });
});

describe("resolveDuration", () => {
  const names = { flag: "--harvest-after", env: "CODETOASTER_HARVEST_AFTER" };

  test("neither set leaves the harvester on its default", () => {
    expect(resolveDuration(undefined, undefined, names)).toBeUndefined();
    // An exported-but-empty variable is a unit file's way of not setting one.
    expect(resolveDuration(undefined, "", names)).toBeUndefined();
  });

  test("the environment is honoured on its own", () => {
    expect(resolveDuration(undefined, "45m", names)).toBe(45 * 60_000);
  });

  test("the flag beats the environment", () => {
    expect(resolveDuration("2h", "1h", names)).toBe(2 * 60 * 60_000);
  });

  test("0 from either side is a real value, not an absence", () => {
    expect(resolveDuration("0", undefined, names)).toBe(0);
    expect(resolveDuration(undefined, "0", names)).toBe(0);
  });

  // `parseArgs` in `strict: false` mode hands back `true` for a declared string
  // flag given no value.
  test("a flag given no value is a typo, not a request", () => {
    expect(() => resolveDuration(true, "1h", names)).toThrow("--harvest-after needs a value");
  });

  test("a bad value names whichever thing carried it", () => {
    expect(() => resolveDuration("90s", undefined, names)).toThrow(
      /^--harvest-after: expected a duration like 30m, 2h or 7d/,
    );
    expect(() => resolveDuration(undefined, "90s", names)).toThrow(
      /^CODETOASTER_HARVEST_AFTER: expected a duration like/,
    );
  });
});

// The respawn contract: `start` re-spells its options onto a `foreground`
// child's argv, so anything missing here is a setting that works in the
// foreground and is silently lost in the background.
describe("daemonArgs", () => {
  test("the port is always spelled, even at its default", () => {
    // Left off, the child would resolve it again from an inherited PORT and
    // bind somewhere other than what the parent reported.
    expect(daemonArgs({ port: 4000 })).toEqual(["--port", "4000"]);
  });

  test("every option is passed through", () => {
    expect(
      daemonArgs({
        port: 4100,
        dbPath: "/tmp/x.db",
        hostname: "0.0.0.0",
        allowedHosts: ["toaster.local", "toaster.lan"],
        harvestAfterMs: 2 * 60 * 60_000,
        evictAfterMs: 7 * 24 * 60 * 60_000,
      }),
    ).toEqual([
      "--port", "4100",
      "--db", "/tmp/x.db",
      "--host", "0.0.0.0",
      "--allowed-host", "toaster.local",
      "--allowed-host", "toaster.lan",
      "--harvest-after", "2h",
      "--evict-after", "7d",
    ]);
  });

  test("disabling a tier survives the respawn", () => {
    // The falsy-check bug: `0` dropped here would hand the child the default
    // the user had just turned off.
    expect(daemonArgs({ port: 4000, harvestAfterMs: 0, evictAfterMs: 0 })).toEqual([
      "--port", "4000",
      "--harvest-after", "0",
      "--evict-after", "0",
    ]);
  });
});
