import { test, expect, describe } from "bun:test";
import * as os from "os";
import { dirLabel } from "./session-manager";

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
