import { test, expect } from "bun:test";
import { mapCapture } from "./captureMap";

test("exact capture names map to token types", () => {
  expect(mapCapture("comment")).toBe("comment");
  expect(mapCapture("string")).toBe("string");
  expect(mapCapture("keyword")).toBe("keyword");
  expect(mapCapture("function")).toBe("function");
  expect(mapCapture("constructor")).toBe("type");
  expect(mapCapture("boolean")).toBe("constant");
  expect(mapCapture("field")).toBe("property");
});

test("dotted capture names fall back to the longest known prefix", () => {
  expect(mapCapture("function.method.builtin")).toBe("function");
  expect(mapCapture("string.special.path")).toBe("string");
  expect(mapCapture("variable.parameter")).toBe("variable");
  expect(mapCapture("keyword.control.conditional")).toBe("keyword");
});

test("explicitly-unstyled names map to null", () => {
  expect(mapCapture("label")).toBeNull();
  expect(mapCapture("escape")).toBeNull();
  expect(mapCapture("none")).toBeNull();
});

test("unknown names map to null", () => {
  expect(mapCapture("totally.unknown.capture")).toBeNull();
  expect(mapCapture("xyzzy")).toBeNull();
});
