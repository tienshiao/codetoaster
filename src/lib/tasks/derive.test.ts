import { test, expect, describe } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { dirLabel, resolveRepoRoot, titleFromPrompt } from "./derive";

describe("dirLabel", () => {
  test("uses the directory basename", () => {
    expect(dirLabel("/Users/tma/Projects/codetoaster")).toBe("codetoaster");
  });

  test("ignores a trailing separator", () => {
    expect(dirLabel("/Users/tma/Projects/codetoaster/")).toBe("codetoaster");
  });

  test("spells out the home directory, trailing separator or not", () => {
    expect(dirLabel(os.homedir())).toBe("~");
    expect(dirLabel(`${os.homedir()}/`)).toBe("~");
  });

  test("spells out the root", () => {
    expect(dirLabel("/")).toBe("/");
  });

  test("returns undefined for an unknown cwd", () => {
    expect(dirLabel(undefined)).toBeUndefined();
  });
});

describe("resolveRepoRoot", () => {
  test("finds the root of a real repository", async () => {
    expect(await resolveRepoRoot(process.cwd())).toBe(process.cwd());
  });

  // Three answers, not two: a root, a definite "no repository" (git exits
  // 128), and "the lookup never ran" — git missing from PATH, or killed at the
  // timeout. Only the first two may be written to a row, which is the rule
  // refreshCwd's guard enforces; the third needs a wedged or absent git to
  // reproduce, so it is covered there rather than here.
  test("a directory outside any repository is null, not the directory itself", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-norepo-"));
    try {
      expect(await resolveRepoRoot(dir)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a directory git cannot even enter is still just 'no repository'", async () => {
    expect(await resolveRepoRoot("/nonexistent-codetoaster-verify")).toBeNull();
  });
});

// §7.5: the prompt that started a task is what the task is called.
describe("titleFromPrompt", () => {
  test("takes the first line", () => {
    expect(titleFromPrompt("fix the parser\nand the tests it broke")).toBe("fix the parser");
  });

  test("skips leading blank lines and trims", () => {
    expect(titleFromPrompt("\n\n   fix the parser   \n\nmore")).toBe("fix the parser");
  });

  test("collapses runs of whitespace inside the line", () => {
    expect(titleFromPrompt("fix   the\tparser")).toBe("fix the parser");
  });

  test("says nothing for a prompt that says nothing", () => {
    // Not defensive: a task can be created with no prompt at all — the
    // sidebar's New task button — and the caller falls back to the directory.
    expect(titleFromPrompt(undefined)).toBeUndefined();
    expect(titleFromPrompt("")).toBeUndefined();
    expect(titleFromPrompt("   \n\t\n  ")).toBeUndefined();
  });

  test("cuts a long line at a word boundary", () => {
    const title = titleFromPrompt(
      "rewrite the commit graph lane assignment so that pagination stays deterministic",
    )!;
    expect(title.length).toBeLessThanOrEqual(61);
    expect(title.endsWith("…")).toBe(true);
    // On a word, not mid-syllable.
    expect(title).toBe("rewrite the commit graph lane assignment so that pagination…");
  });

  test("cuts a single overlong word where it falls", () => {
    const title = titleFromPrompt("a".repeat(200))!;
    // No boundary to find, so the budget is the only thing deciding.
    expect(title).toBe(`${"a".repeat(60)}…`);
  });

  test("keeps a line that exactly fits", () => {
    const exact = "x".repeat(60);
    expect(titleFromPrompt(exact)).toBe(exact);
  });
});
