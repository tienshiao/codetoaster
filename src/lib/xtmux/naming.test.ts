import { test, expect, describe } from "bun:test";
import {
  formatDerivedName,
  meaningfulTitle,
  sessionDisplayNames,
  stripDecoration,
  uniqueName,
} from "./naming";

describe("stripDecoration", () => {
  test("drops leading glyphs TUIs prefix", () => {
    expect(stripDecoration("✳ Implementing latch naming")).toBe("Implementing latch naming");
  });

  test("drops a leading shell name", () => {
    expect(stripDecoration("fish ~/P/codetoaster")).toBe("~/P/codetoaster");
    expect(stripDecoration("-bash /Users/tma")).toBe("/Users/tma");
  });

  test("keeps a shell name that is the whole title", () => {
    expect(stripDecoration("fish")).toBe("fish");
  });

  test("collapses control characters and runs of whitespace", () => {
    expect(stripDecoration("bun\ttest   --watch\r")).toBe("bun test --watch");
  });
});

describe("meaningfulTitle", () => {
  test("accepts a title with real content", () => {
    expect(meaningfulTitle("✳ Implementing latch naming")).toBe("Implementing latch naming");
    expect(meaningfulTitle("bun test --watch")).toBe("bun test --watch");
    expect(meaningfulTitle("foo.ts (~/Projects/x) - VIM")).toBe("foo.ts (~/Projects/x) - VIM");
  });

  test("rejects the default titles shells emit", () => {
    expect(meaningfulTitle("tma@laptop: ~/Projects/codetoaster")).toBeNull();
    expect(meaningfulTitle("fish ~/P/codetoaster")).toBeNull();
    expect(meaningfulTitle("/Users/tma/Projects/codetoaster")).toBeNull();
    expect(meaningfulTitle("")).toBeNull();
    expect(meaningfulTitle("   ")).toBeNull();
    expect(meaningfulTitle(undefined)).toBeNull();
  });

  test("rejects a bare program name, which says less than dir and branch", () => {
    expect(meaningfulTitle("claude")).toBeNull();
    expect(meaningfulTitle("vim")).toBeNull();
    expect(meaningfulTitle("docker-compose")).toBeNull();
  });

  test("accepts a spaceless slug, which is a description", () => {
    expect(meaningfulTitle("\u2733 setup-scheduler-staging-env")).toBe("setup-scheduler-staging-env");
    expect(meaningfulTitle("wire_marbi_update_cron")).toBe("wire_marbi_update_cron");
  });

  test("a slug still loses to the shell filters that precede it", () => {
    expect(meaningfulTitle("fish ~/Projects/marbi/marbi-cloud")).toBeNull();
    expect(meaningfulTitle("/Users/tma/some-long-path/here")).toBeNull();
  });

  test("truncates an overlong title", () => {
    const name = meaningfulTitle(`${"word ".repeat(30)}end`)!;
    expect(name.length).toBe(60);
    expect(name.endsWith("…")).toBe(true);
  });
});

describe("sessionDisplayNames", () => {
  const labels = (sessions: Parameters<typeof sessionDisplayNames>[0]) =>
    sessions.map((s) => sessionDisplayNames(sessions).get(s.id));

  test("shows the title over a derived name", () => {
    expect(labels([
      { id: "a", name: "codetoaster · main", nameSource: "derived", title: "✳ Implementing latch naming" },
    ])).toEqual(["Implementing latch naming"]);
  });

  test("follows the title as it changes — nothing is frozen", () => {
    const at = (title: string) =>
      labels([{ id: "a", name: "codetoaster · main", nameSource: "derived", title }])[0];
    expect(at("Claude Code")).toBe("Claude Code");
    expect(at("✳ Wiring the parser")).toBe("Wiring the parser");
  });

  test("falls back to the derived name when the title says nothing", () => {
    const at = (title?: string) =>
      labels([{ id: "a", name: "codetoaster · main", nameSource: "derived", title }])[0];
    expect(at("fish ~/P/codetoaster")).toBe("codetoaster · main");
    expect(at("")).toBe("codetoaster · main");
    expect(at()).toBe("codetoaster · main");
  });

  test("an explicit rename outranks any title", () => {
    expect(labels([
      { id: "a", name: "Billing spike", nameSource: "manual", title: "✳ Implementing latch naming" },
    ])).toEqual(["Billing spike"]);
  });

  test("treats a missing nameSource as derived", () => {
    expect(labels([{ id: "a", name: "New Session", title: "bun test --watch" }])).toEqual(["bun test --watch"]);
  });

  test("a shared title identifies nothing, so those sessions show their names", () => {
    expect(labels([
      { id: "a", name: "codetoaster · main", nameSource: "derived", title: "Claude Code" },
      { id: "b", name: "codetoaster · main 2", nameSource: "derived", title: "Claude Code" },
      { id: "c", name: "video-toaster · main", nameSource: "derived", title: "Claude Code" },
    ])).toEqual(["codetoaster · main", "codetoaster · main 2", "video-toaster · main"]);
  });

  test("a session reclaims its title as soon as it is the only one holding it", () => {
    expect(labels([
      { id: "a", name: "codetoaster · main", nameSource: "derived", title: "✳ Wiring the parser" },
      { id: "b", name: "codetoaster · main 2", nameSource: "derived", title: "Claude Code" },
      { id: "c", name: "video-toaster · main", nameSource: "derived", title: "Claude Code" },
    ])).toEqual(["Wiring the parser", "codetoaster · main 2", "video-toaster · main"]);
  });

  test("collision is judged case-insensitively, as the slug would be", () => {
    expect(labels([
      { id: "a", name: "codetoaster · main", nameSource: "derived", title: "Claude Code" },
      { id: "b", name: "codetoaster · main 2", nameSource: "derived", title: "claude code" },
    ])).toEqual(["codetoaster · main", "codetoaster · main 2"]);
  });

  test("a title colliding with a manual name is ambiguous too", () => {
    expect(labels([
      { id: "a", name: "Claude Code", nameSource: "manual", title: "" },
      { id: "b", name: "codetoaster · main", nameSource: "derived", title: "Claude Code" },
    ])).toEqual(["Claude Code", "codetoaster · main"]);
  });
});

describe("formatDerivedName", () => {
  test("joins directory and branch", () => {
    expect(formatDerivedName("codetoaster", "split-view")).toBe("codetoaster · split-view");
  });

  test("omits the branch outside a repo", () => {
    expect(formatDerivedName("Downloads")).toBe("Downloads");
  });

  test("falls back when the cwd is unknown", () => {
    expect(formatDerivedName(undefined)).toBe("Shell");
  });
});

describe("uniqueName", () => {
  test("passes an unused name through", () => {
    expect(uniqueName("codetoaster · main", ["other"])).toBe("codetoaster · main");
  });

  test("suffixes collisions", () => {
    const taken = ["codetoaster · main"];
    expect(uniqueName("codetoaster · main", taken)).toBe("codetoaster · main 2");
    expect(uniqueName("codetoaster · main", [...taken, "codetoaster · main 2"]))
      .toBe("codetoaster · main 3");
  });
});
