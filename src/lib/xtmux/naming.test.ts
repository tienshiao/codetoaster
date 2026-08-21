import { test, expect, describe } from "bun:test";
import {
  deriveTitleName,
  formatProvisionalName,
  stripDecoration,
  titleAddsInfo,
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

describe("deriveTitleName", () => {
  test("latches onto a title with real content", () => {
    expect(deriveTitleName("✳ Implementing latch naming")).toBe("Implementing latch naming");
    expect(deriveTitleName("bun test --watch")).toBe("bun test --watch");
    expect(deriveTitleName("foo.ts (~/Projects/x) - VIM")).toBe("foo.ts (~/Projects/x) - VIM");
  });

  test("rejects the default titles shells emit", () => {
    expect(deriveTitleName("tma@laptop: ~/Projects/codetoaster")).toBeNull();
    expect(deriveTitleName("fish ~/P/codetoaster")).toBeNull();
    expect(deriveTitleName("/Users/tma/Projects/codetoaster")).toBeNull();
    expect(deriveTitleName("")).toBeNull();
    expect(deriveTitleName("   ")).toBeNull();
  });

  test("rejects a bare program name so a better title can still land", () => {
    expect(deriveTitleName("claude")).toBeNull();
    expect(deriveTitleName("vim")).toBeNull();
  });

  test("rejects a title that only repeats the provisional name", () => {
    expect(deriveTitleName("codetoaster · main", "codetoaster · main")).toBeNull();
    expect(deriveTitleName("Codetoaster · Main", "codetoaster · main")).toBeNull();
  });

  test("truncates an overlong title", () => {
    const name = deriveTitleName(`${"word ".repeat(30)}end`)!;
    expect(name.length).toBe(60);
    expect(name.endsWith("…")).toBe(true);
  });
});

describe("titleAddsInfo", () => {
  test("false once the name has latched onto that title", () => {
    expect(titleAddsInfo("Implementing latch naming", "✳ Implementing latch naming")).toBe(false);
  });

  test("true while the name is still provisional", () => {
    expect(titleAddsInfo("codetoaster · main", "✳ Implementing latch naming")).toBe(true);
  });

  test("false for an empty title", () => {
    expect(titleAddsInfo("codetoaster · main", "")).toBe(false);
  });
});

describe("formatProvisionalName", () => {
  test("joins directory and branch", () => {
    expect(formatProvisionalName("codetoaster", "split-view")).toBe("codetoaster · split-view");
  });

  test("omits the branch outside a repo", () => {
    expect(formatProvisionalName("Downloads")).toBe("Downloads");
  });

  test("falls back when the cwd is unknown", () => {
    expect(formatProvisionalName(undefined)).toBe("Shell");
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
