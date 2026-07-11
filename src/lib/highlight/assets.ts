// Static asset imports for tree-sitter. ALL wasm/query imports live here so
// `bun build --compile` statically embeds them into the standalone binary.
// `with { type: "file" }` yields a path (on-disk in dev, embedded-asset path in
// the compiled binary) — always read it via `Bun.file(path).arrayBuffer()`,
// never hand the path to the wasm runtime's own file resolver.
//
// Grammar sourcing (all modern, ABI-compatible with web-tree-sitter 0.26.x):
//   - @vscode/tree-sitter-wasm: the languages VS Code ships (well-maintained)
//   - tree-sitter-json / tree-sitter-c / tree-sitter-html: upstream grammar builds
//   - @tree-sitter-grammars/{toml,kotlin,yaml}: community org builds
// Swift/xml/sql/markdown have no compatible prebuilt grammar and fall back to the
// regex highlighter (src/frontend/utils/syntaxHighlight.ts) on the client.

// Runtime engine wasm
import runtimeWasm from "web-tree-sitter/web-tree-sitter.wasm" with { type: "file" };

// @vscode/tree-sitter-wasm grammars
import typescriptWasm from "@vscode/tree-sitter-wasm/wasm/tree-sitter-typescript.wasm" with { type: "file" };
import tsxWasm from "@vscode/tree-sitter-wasm/wasm/tree-sitter-tsx.wasm" with { type: "file" };
import javascriptWasm from "@vscode/tree-sitter-wasm/wasm/tree-sitter-javascript.wasm" with { type: "file" };
import cssWasm from "@vscode/tree-sitter-wasm/wasm/tree-sitter-css.wasm" with { type: "file" };
import pythonWasm from "@vscode/tree-sitter-wasm/wasm/tree-sitter-python.wasm" with { type: "file" };
import goWasm from "@vscode/tree-sitter-wasm/wasm/tree-sitter-go.wasm" with { type: "file" };
import rustWasm from "@vscode/tree-sitter-wasm/wasm/tree-sitter-rust.wasm" with { type: "file" };
import cppWasm from "@vscode/tree-sitter-wasm/wasm/tree-sitter-cpp.wasm" with { type: "file" };
import javaWasm from "@vscode/tree-sitter-wasm/wasm/tree-sitter-java.wasm" with { type: "file" };
import phpWasm from "@vscode/tree-sitter-wasm/wasm/tree-sitter-php.wasm" with { type: "file" };
import bashWasm from "@vscode/tree-sitter-wasm/wasm/tree-sitter-bash.wasm" with { type: "file" };
import rubyWasm from "@vscode/tree-sitter-wasm/wasm/tree-sitter-ruby.wasm" with { type: "file" };

// Upstream / community grammar builds
import jsonWasm from "tree-sitter-json/tree-sitter-json.wasm" with { type: "file" };
import cWasm from "tree-sitter-c/tree-sitter-c.wasm" with { type: "file" };
import htmlWasm from "tree-sitter-html/tree-sitter-html.wasm" with { type: "file" };
import tomlWasm from "@tree-sitter-grammars/tree-sitter-toml/tree-sitter-toml.wasm" with { type: "file" };
import kotlinWasm from "@tree-sitter-grammars/tree-sitter-kotlin/tree-sitter-kotlin.wasm" with { type: "file" };
import yamlWasm from "@tree-sitter-grammars/tree-sitter-yaml/tree-sitter-yaml.wasm" with { type: "file" };

// Highlight queries (vendored under ./queries/<id>/highlights.scm)
import typescriptHighlights from "./queries/typescript/highlights.scm" with { type: "text" };
import tsxHighlights from "./queries/tsx/highlights.scm" with { type: "text" };
import javascriptHighlights from "./queries/javascript/highlights.scm" with { type: "text" };
import cssHighlights from "./queries/css/highlights.scm" with { type: "text" };
import pythonHighlights from "./queries/python/highlights.scm" with { type: "text" };
import goHighlights from "./queries/go/highlights.scm" with { type: "text" };
import rustHighlights from "./queries/rust/highlights.scm" with { type: "text" };
import cppHighlights from "./queries/cpp/highlights.scm" with { type: "text" };
import javaHighlights from "./queries/java/highlights.scm" with { type: "text" };
import phpHighlights from "./queries/php/highlights.scm" with { type: "text" };
import bashHighlights from "./queries/bash/highlights.scm" with { type: "text" };
import rubyHighlights from "./queries/ruby/highlights.scm" with { type: "text" };
import jsonHighlights from "./queries/json/highlights.scm" with { type: "text" };
import cHighlights from "./queries/c/highlights.scm" with { type: "text" };
import htmlHighlights from "./queries/html/highlights.scm" with { type: "text" };
import tomlHighlights from "./queries/toml/highlights.scm" with { type: "text" };
import kotlinHighlights from "./queries/kotlin/highlights.scm" with { type: "text" };
import yamlHighlights from "./queries/yaml/highlights.scm" with { type: "text" };

export type GrammarId =
  | "typescript" | "tsx" | "javascript" | "css" | "python" | "go" | "rust"
  | "cpp" | "java" | "php" | "bash" | "ruby" | "json" | "c" | "html"
  | "toml" | "kotlin" | "yaml";

export interface GrammarAsset {
  /** Path to the grammar wasm (readable via Bun.file). */
  wasm: string;
  /** Vendored highlights.scm source text. */
  highlights: string;
}

export const RUNTIME_WASM: string = runtimeWasm;

export const GRAMMARS: Record<GrammarId, GrammarAsset> = {
  typescript: { wasm: typescriptWasm, highlights: typescriptHighlights },
  tsx: { wasm: tsxWasm, highlights: tsxHighlights },
  javascript: { wasm: javascriptWasm, highlights: javascriptHighlights },
  css: { wasm: cssWasm, highlights: cssHighlights },
  python: { wasm: pythonWasm, highlights: pythonHighlights },
  go: { wasm: goWasm, highlights: goHighlights },
  rust: { wasm: rustWasm, highlights: rustHighlights },
  cpp: { wasm: cppWasm, highlights: cppHighlights },
  java: { wasm: javaWasm, highlights: javaHighlights },
  php: { wasm: phpWasm, highlights: phpHighlights },
  bash: { wasm: bashWasm, highlights: bashHighlights },
  ruby: { wasm: rubyWasm, highlights: rubyHighlights },
  json: { wasm: jsonWasm, highlights: jsonHighlights },
  c: { wasm: cWasm, highlights: cHighlights },
  html: { wasm: htmlWasm, highlights: htmlHighlights },
  toml: { wasm: tomlWasm, highlights: tomlHighlights },
  kotlin: { wasm: kotlinWasm, highlights: kotlinHighlights },
  yaml: { wasm: yamlWasm, highlights: yamlHighlights },
};
