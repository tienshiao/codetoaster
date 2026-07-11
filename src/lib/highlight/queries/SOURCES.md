# Highlight query sources

`highlights.scm` files here are hand-authored for CodeToaster, validated to
compile and run `captures()` against the exact grammar wasm builds we ship (see
`queries.test.ts`, the CI tripwire). They are intentionally conservative: they
capture the token classes our renderer distinguishes (see `SyntaxTokenType` in
`src/types/highlight.ts`) and map cleanly through `captureMap.ts`. They are not
copies of any upstream query set.

They can be replaced piecemeal with richer upstream queries (nvim-treesitter,
Helix, or each grammar's own `queries/highlights.scm`) — `captureMap.ts` already
handles the dotted hierarchical capture names those use. Any replacement must
keep `queries.test.ts` green against the pinned grammar builds.

## Grammar wasm sources (all modern, web-tree-sitter 0.26.x ABI)

| Grammar(s) | Package |
| --- | --- |
| typescript, tsx, javascript, css, python, go, rust, cpp, java, php, bash, ruby | `@vscode/tree-sitter-wasm` |
| json | `tree-sitter-json` |
| c | `tree-sitter-c` |
| html | `tree-sitter-html` |
| toml | `@tree-sitter-grammars/tree-sitter-toml` |
| kotlin | `@tree-sitter-grammars/tree-sitter-kotlin` |
| yaml | `@tree-sitter-grammars/tree-sitter-yaml` |

Swift, XML, SQL, Markdown, and SCSS/LESS have no compatible prebuilt grammar and
use the client-side regex highlighter (`src/frontend/utils/syntaxHighlight.ts`).
