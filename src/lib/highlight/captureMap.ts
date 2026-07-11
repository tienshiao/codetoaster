import type { SyntaxTokenType } from "../../types/highlight";

// Maps a tree-sitter capture name to one of our render token types. Our vendored
// queries already use these names directly, but this also handles the dotted,
// hierarchical capture names used by upstream nvim-treesitter-style queries
// (e.g. "function.method.builtin") via longest-prefix fallback, so richer query
// sets can be dropped in later without touching the tokenizer.
//
// Uses Maps rather than object literals so keys like "constructor" don't collide
// with Object.prototype members.

// Exact names checked first.
const EXACT = new Map<string, SyntaxTokenType | null>([
  ["comment", "comment"],
  ["string", "string"],
  ["character", "string"],
  ["keyword", "keyword"],
  ["conditional", "keyword"],
  ["repeat", "keyword"],
  ["include", "keyword"],
  ["exception", "keyword"],
  ["number", "number"],
  ["float", "number"],
  ["operator", "operator"],
  ["type", "type"],
  ["constructor", "type"],
  ["namespace", "type"],
  ["module", "type"],
  ["function", "function"],
  ["method", "function"],
  ["variable", "variable"],
  ["property", "property"],
  ["field", "property"],
  ["constant", "constant"],
  ["boolean", "constant"],
  ["tag", "tag"],
  ["attribute", "attribute"],
  ["punctuation", "punctuation"],
  // Explicitly unstyled
  ["label", null],
  ["escape", null],
  ["embedded", null],
  ["none", null],
  ["spell", null],
]);

// Prefix fallbacks (first dotted path segment) for hierarchical capture names.
const PREFIX = new Map<string, SyntaxTokenType | null>([
  ["comment", "comment"],
  ["string", "string"],
  ["character", "string"],
  ["keyword", "keyword"],
  ["conditional", "keyword"],
  ["repeat", "keyword"],
  ["number", "number"],
  ["float", "number"],
  ["operator", "operator"],
  ["type", "type"],
  ["constructor", "type"],
  ["namespace", "type"],
  ["function", "function"],
  ["method", "function"],
  ["variable", "variable"],
  ["property", "property"],
  ["field", "property"],
  ["constant", "constant"],
  ["boolean", "constant"],
  ["tag", "tag"],
  ["attribute", "attribute"],
  ["punctuation", "punctuation"],
]);

export function mapCapture(name: string): SyntaxTokenType | null {
  if (EXACT.has(name)) return EXACT.get(name)!;
  // Try progressively shorter dotted prefixes: a.b.c -> a.b -> a
  const parts = name.split(".");
  for (let i = parts.length - 1; i > 0; i--) {
    const prefix = parts.slice(0, i).join(".");
    if (EXACT.has(prefix)) return EXACT.get(prefix)!;
  }
  const head = parts[0]!;
  if (PREFIX.has(head)) return PREFIX.get(head)!;
  return null;
}
