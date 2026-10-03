import { test, expect } from "bun:test";
import { defaultParseSearch } from "@tanstack/react-router";
import { fileTabHref, parseTabSearch } from "./tab-link";

/** What the route sees for an href this module built. */
function roundTrip(href: string) {
  return parseTabSearch(defaultParseSearch(href.slice(href.indexOf("?"))));
}

test("a file tab URL names the tab by its key", () => {
  const href = fileTabHref("/t/wiki-abc", { path: "wiki/services/archive.md" });
  expect(href.startsWith("/t/wiki-abc?")).toBe(true);
  expect(roundTrip(href)).toEqual({ tab: "file:wiki/services/archive.md" });
});

test("line and anchor ride beside the key", () => {
  expect(roundTrip(fileTabHref("/t/x", { path: "src/a.ts", line: 12 }))).toEqual({ tab: "file:src/a.ts", line: 12 });
  expect(roundTrip(fileTabHref("/t/x", { path: "wiki/a.md", anchor: "markdown-header-led-api-2" }))).toEqual({
    tab: "file:wiki/a.md",
    anchor: "markdown-header-led-api-2",
  });
});

test("an anchor that looks like a number, or like JSON, stays a string", () => {
  for (const anchor of ["2024", "true", "null", "1e3", '{"a":1}']) {
    expect(roundTrip(fileTabHref("/t/x", { path: "a.md", anchor }))).toEqual({ tab: "file:a.md", anchor });
  }
});

test("paths with spaces, colons and non-ASCII survive", () => {
  const path = "puffco/LED API 3: café.md";
  expect(roundTrip(fileTabHref("/t/x", { path, anchor: "café crème" }))).toEqual({
    tab: `file:${path}`,
    anchor: "café crème",
  });
});

test("a malformed search keeps only what is well formed", () => {
  expect(parseTabSearch({ tab: "", line: 0, anchor: 5 })).toEqual({});
  expect(parseTabSearch({ tab: "agent", line: 2.5, anchor: "" })).toEqual({ tab: "agent" });
});
