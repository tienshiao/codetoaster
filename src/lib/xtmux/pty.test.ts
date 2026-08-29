import { test, expect } from "bun:test";
import { sanitizeSize } from "./session";

test("accepts workable integer sizes", () => {
  expect(sanitizeSize(80, 24)).toEqual({ cols: 80, rows: 24 });
  expect(sanitizeSize(2, 1)).toEqual({ cols: 2, rows: 1 });
  expect(sanitizeSize(10000, 10000)).toEqual({ cols: 10000, rows: 10000 });
});

test("rejects missing or non-numeric values", () => {
  expect(sanitizeSize(undefined, undefined)).toBeNull();
  expect(sanitizeSize(null, null)).toBeNull();
  expect(sanitizeSize("80", "24")).toBeNull();
  expect(sanitizeSize(80, undefined)).toBeNull();
  expect(sanitizeSize(undefined, 24)).toBeNull();
});

test("rejects NaN, infinities, and floats", () => {
  expect(sanitizeSize(NaN, 24)).toBeNull();
  expect(sanitizeSize(80, NaN)).toBeNull();
  expect(sanitizeSize(Infinity, 24)).toBeNull();
  expect(sanitizeSize(80.5, 24)).toBeNull();
});

test("rejects sizes below the workable floor or above the cap", () => {
  expect(sanitizeSize(0, 0)).toBeNull();
  expect(sanitizeSize(1, 1)).toBeNull(); // cols floor is 2
  expect(sanitizeSize(2, 0)).toBeNull();
  expect(sanitizeSize(-80, 24)).toBeNull();
  expect(sanitizeSize(10001, 24)).toBeNull();
  expect(sanitizeSize(80, 10001)).toBeNull();
});
