import { test, expect, describe } from "bun:test";
import { formatSize } from "./formatSize";

describe("formatSize", () => {
  test("bytes carry no decimal", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(999)).toBe("999 B");
  });

  test("scales, keeping three significant figures at most", () => {
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(20 * 1024)).toBe("20 KB");
    expect(formatSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatSize(5 * 1024 * 1024 * 1024)).toBe("5.0 GB");
  });
});
