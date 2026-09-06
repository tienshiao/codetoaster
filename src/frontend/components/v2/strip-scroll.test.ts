import { test, expect } from "bun:test";
import { revealScrollLeft } from "./strip-scroll";

test("a tab already in view leaves the offset alone", () => {
  expect(revealScrollLeft(100, 400, 150, 250)).toBe(100);
  // Flush with either edge still counts as in view.
  expect(revealScrollLeft(100, 400, 100, 200)).toBe(100);
  expect(revealScrollLeft(100, 400, 400, 500)).toBe(100);
});

test("a tab past the trailing edge scrolls just far enough to show its end", () => {
  expect(revealScrollLeft(0, 400, 450, 550)).toBe(150);
  expect(revealScrollLeft(100, 400, 480, 520)).toBe(120);
});

test("a tab before the leading edge scrolls back to its start", () => {
  expect(revealScrollLeft(300, 400, 100, 200)).toBe(100);
  // Partly hidden on the left is still hidden.
  expect(revealScrollLeft(150, 400, 100, 200)).toBe(100);
});

test("a tab wider than the strip is aligned to its start", () => {
  expect(revealScrollLeft(0, 200, 300, 600)).toBe(300);
  expect(revealScrollLeft(500, 200, 300, 600)).toBe(300);
});
