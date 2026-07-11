import { test, expect } from "bun:test";
import { highlightContent, highlightFile, MAX_CONTENT_LENGTH } from "./tokenize";
import { _clearCache } from "./cache";

function reconstruct(tokens: { text: string }[][]): string[] {
  return tokens.map((line) => line.map((t) => t.text).join(""));
}

test("reconstruction invariant holds for a rich TS snippet", async () => {
  const src = [
    "// a comment",
    "const greeting = `hello ${name}`;",
    "function add(a: number, b: number): number { return a + b; }",
  ].join("\n");
  const tokens = (await highlightContent(src, "typescript"))!;
  expect(tokens).not.toBeNull();
  expect(reconstruct(tokens)).toEqual(src.split("\n"));
});

test("multi-line block comment splits per line, type preserved on each", async () => {
  const src = "before\n/* line one\n   line two */\nafter";
  const tokens = (await highlightContent(src, "typescript"))!;
  expect(reconstruct(tokens)).toEqual(src.split("\n"));
  // The two comment lines each carry a comment token.
  expect(tokens[1]!.some((t) => t.type === "comment")).toBe(true);
  expect(tokens[2]!.some((t) => t.type === "comment")).toBe(true);
});

test("CRLF content reconstructs exactly (\\r rides along)", async () => {
  const src = "const x = 1;\r\nconst y = 2;\r\n";
  const tokens = (await highlightContent(src, "typescript"))!;
  const lines = reconstruct(tokens);
  expect(lines).toEqual(src.split("\n"));
  expect(lines[0]!.endsWith("\r")).toBe(true);
});

test("emoji and CJK keep exact boundaries", async () => {
  const src = 'const s = "héllo 🎉 世界";';
  const tokens = (await highlightContent(src, "typescript"))!;
  expect(reconstruct(tokens)).toEqual(src.split("\n"));
});

test("empty file yields one empty line", async () => {
  const tokens = (await highlightContent("", "typescript"))!;
  expect(tokens).toEqual([[]]);
});

test("trailing newline yields a final empty line", async () => {
  const tokens = (await highlightContent("const x = 1;\n", "typescript"))!;
  expect(reconstruct(tokens)).toEqual(["const x = 1;", ""]);
});

test("highlightFile returns null for unsupported extensions", async () => {
  _clearCache();
  expect(await highlightFile("SELECT 1;", "q.sql")).toBeNull();
  expect(await highlightFile("hi", "notes.md")).toBeNull();
});

test("highlightFile returns null for oversized content", async () => {
  _clearCache();
  const huge = "a".repeat(MAX_CONTENT_LENGTH + 1);
  expect(await highlightFile(huge, "big.ts")).toBeNull();
});

test("highlightFile caches by content", async () => {
  _clearCache();
  const src = "const x: number = 1;";
  const a = await highlightFile(src, "a.ts");
  const b = await highlightFile(src, "b.ts"); // same content, different path
  expect(a).toBe(b); // identical cached reference
});
