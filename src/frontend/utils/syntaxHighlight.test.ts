import { test, expect } from "bun:test";
import { tokenizeLine, MAX_TOKENIZE_CHARS } from "./syntaxHighlight";
import { getLanguageFromPath } from "./languageDetection";

const ts = getLanguageFromPath("x.ts")!;

test("tokenizeLine highlights an ordinary line", () => {
  const tokens = tokenizeLine('const x = "y";', ts);
  expect(tokens.some((t) => t.type === "keyword" && t.text === "const")).toBe(true);
  expect(tokens.map((t) => t.text).join("")).toBe('const x = "y";');
});

// TASK-117: a per-position regex scan over a megabyte line froze the page.
test("tokenizeLine returns a line past MAX_TOKENIZE_CHARS as one plain token", () => {
  const line = "const x = 1; ".repeat(Math.ceil((MAX_TOKENIZE_CHARS + 1) / 13));
  expect(line.length).toBeGreaterThan(MAX_TOKENIZE_CHARS);
  expect(tokenizeLine(line, ts)).toEqual([{ text: line, type: null }]);
});

test("tokenizeLine still tokenizes a line at the budget", () => {
  const line = "const".padEnd(MAX_TOKENIZE_CHARS, " ");
  const tokens = tokenizeLine(line, ts);
  expect(tokens[0]).toEqual({ text: "const", type: "keyword" });
});
