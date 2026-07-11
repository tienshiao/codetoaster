// Vendored tree-sitter tags queries (definitions + references), imported as text
// so `bun build --compile` embeds them. Grammar wasm is shared with the
// highlighter (src/lib/highlight/assets.ts) — this module only adds the queries.
import type { GrammarId } from "../highlight/assets";

import typescriptTags from "./queries/typescript/tags.scm" with { type: "text" };
import tsxTags from "./queries/tsx/tags.scm" with { type: "text" };
import javascriptTags from "./queries/javascript/tags.scm" with { type: "text" };
import pythonTags from "./queries/python/tags.scm" with { type: "text" };
import goTags from "./queries/go/tags.scm" with { type: "text" };
import rustTags from "./queries/rust/tags.scm" with { type: "text" };
import rubyTags from "./queries/ruby/tags.scm" with { type: "text" };
import javaTags from "./queries/java/tags.scm" with { type: "text" };
import cTags from "./queries/c/tags.scm" with { type: "text" };
import cppTags from "./queries/cpp/tags.scm" with { type: "text" };

// Grammars that have a tags query (a subset of the highlighter's grammars).
export type SymbolGrammarId = Extract<
  GrammarId,
  "typescript" | "tsx" | "javascript" | "python" | "go" | "rust" | "ruby" | "java" | "c" | "cpp"
>;

export const TAGS_QUERIES: Record<SymbolGrammarId, string> = {
  typescript: typescriptTags,
  tsx: tsxTags,
  javascript: javascriptTags,
  python: pythonTags,
  go: goTags,
  rust: rustTags,
  ruby: rubyTags,
  java: javaTags,
  c: cTags,
  cpp: cppTags,
};

const EXTENSION_TO_SYMBOL_GRAMMAR: Record<string, SymbolGrammarId> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  py: "python",
  pyw: "python",
  go: "go",
  rs: "rust",
  rb: "ruby",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  cxx: "cpp",
  cc: "cpp",
  hpp: "cpp",
  hh: "cpp",
};

export function symbolGrammarForPath(filePath: string): SymbolGrammarId | null {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  return EXTENSION_TO_SYMBOL_GRAMMAR[ext] ?? null;
}
