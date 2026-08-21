import { test, expect, describe } from "bun:test";
import {
  formatDerivedName,
  meaningfulTitle,
  sessionDisplayName,
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
  });

  test("truncates an overlong title", () => {
    const name = meaningfulTitle(`${"word ".repeat(30)}end`)!;
    expect(name.length).toBe(60);
    expect(name.endsWith("…")).toBe(true);
  });
});

describe("sessionDisplayName", () => {
  test("shows the title over a derived name", () => {
    expect(sessionDisplayName({
      name: "codetoaster · main",
      nameSource: "derived",
      title: "✳ Implementing latch naming",
    })).toBe("Implementing latch naming");
  });

  test("follows the title as it changes — nothing is frozen", () => {
    const session = { name: "codetoaster · main", nameSource: "derived" as const };
    expect(sessionDisplayName({ ...session, title: "Claude Code" })).toBe("Claude Code");
    expect(sessionDisplayName({ ...session, title: "✳ Wiring the parser" })).toBe("Wiring the parser");
  });

  test("falls back to the derived name when the title says nothing", () => {
    const session = { name: "codetoaster · main", nameSource: "derived" as const };
    expect(sessionDisplayName({ ...session, title: "fish ~/P/codetoaster" })).toBe("codetoaster · main");
    expect(sessionDisplayName({ ...session, title: "" })).toBe("codetoaster · main");
    expect(sessionDisplayName(session)).toBe("codetoaster · main");
  });

  test("an explicit rename outranks any title", () => {
    expect(sessionDisplayName({
      name: "Billing spike",
      nameSource: "manual",
      title: "✳ Implementing latch naming",
    })).toBe("Billing spike");
  });

  test("treats a missing nameSource as derived, so an optimistic row still shows its title", () => {
    expect(sessionDisplayName({ name: "New Session", title: "bun test --watch" })).toBe("bun test --watch");
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
