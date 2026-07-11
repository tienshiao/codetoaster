import type { GrammarId } from "./assets";

// Maps a file path to a tree-sitter grammar. Anything not listed here (swift,
// xml, sql, markdown, scss/less, ...) returns null and is highlighted by the
// client-side regex fallback instead.
const EXTENSION_TO_GRAMMAR: Record<string, GrammarId> = {
  // TypeScript — the plain-TS grammar (NOT tsx): `<T>expr` casts parse wrong under tsx
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  // TSX / JSX — the tsx grammar; the javascript grammar also handles JSX natively
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  // Data / config
  json: "json",
  jsonc: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  // Web
  css: "css",
  html: "html",
  htm: "html",
  // Systems / general
  py: "python",
  pyw: "python",
  go: "go",
  rs: "rust",
  c: "c",
  h: "c",
  cpp: "cpp",
  cxx: "cpp",
  cc: "cpp",
  hpp: "cpp",
  hh: "cpp",
  java: "java",
  php: "php",
  rb: "ruby",
  kt: "kotlin",
  kts: "kotlin",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
};

export function grammarForPath(filePath: string): GrammarId | null {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  return EXTENSION_TO_GRAMMAR[ext] ?? null;
}
