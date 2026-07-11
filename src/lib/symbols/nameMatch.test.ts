import { test, expect } from "bun:test";
import { scoreName } from "./nameMatch";

test("returns null when the query is not a subsequence", () => {
  expect(scoreName("getDiffTokens", "xyz")).toBeNull();
  expect(scoreName("foo", "food")).toBeNull(); // longer than the name
});

test("empty query scores neutrally rather than failing", () => {
  expect(scoreName("anything", "")).toBe(0);
});

test("exact (case-insensitive) beats everything", () => {
  const exact = scoreName("helper", "helper")!;
  const prefix = scoreName("helperFunction", "helper")!;
  expect(exact).toBeGreaterThan(prefix);
});

test("prefix beats a mid-name subsequence match", () => {
  const prefix = scoreName("getUser", "get")!;
  const scattered = scoreName("widgetTarget", "get")!;
  expect(prefix).toBeGreaterThan(scattered);
});

test("camelCase humps are rewarded (gdt -> getDiffTokens)", () => {
  const humps = scoreName("getDiffTokens", "gdt")!;
  const contiguousMid = scoreName("agdtx", "gdt")!;
  expect(humps).toBeGreaterThan(contiguousMid);
});

test("underscore boundaries match like word starts", () => {
  expect(scoreName("read_old_side", "ros")).not.toBeNull();
  const boundary = scoreName("read_old_side", "ros")!;
  const scattered = scoreName("aroasoside", "ros")!;
  expect(boundary).toBeGreaterThan(scattered);
});
