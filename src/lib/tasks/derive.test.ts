import { test, expect, describe } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { dirLabel, resolveRepoRoot } from "./derive";

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
