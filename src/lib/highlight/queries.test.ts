import { test, expect } from "bun:test";
import { Parser, Language, Query } from "web-tree-sitter";
import { RUNTIME_WASM, GRAMMARS, type GrammarId } from "./assets";

// ABI-drift tripwire: every vendored grammar must load, its highlights query
// must compile, and captures() must run without crashing. If a grammar bump or
// query edit breaks any of these, this fails in CI rather than silently at
// runtime. No language is currently allowed to be on a minimal fallback.
const KNOWN_FALLBACK: GrammarId[] = [];

let initialized: Promise<void> | null = null;
function init() {
  if (!initialized) {
    initialized = (async () => {
      const wasmBinary = new Uint8Array(await Bun.file(RUNTIME_WASM).arrayBuffer());
      await Parser.init({ wasmBinary });
    })();
  }
  return initialized;
}

const ids = Object.keys(GRAMMARS) as GrammarId[];

for (const id of ids) {
  test(`grammar "${id}" loads, compiles its query, and captures`, async () => {
    await init();
    const asset = GRAMMARS[id];
    const language = await Language.load(new Uint8Array(await Bun.file(asset.wasm).arrayBuffer()));
    const query = new Query(language, asset.highlights);
    const parser = new Parser();
    parser.setLanguage(language);
    const tree = parser.parse("")!;
    expect(() => query.captures(tree.rootNode)).not.toThrow();
    tree.delete();
    expect(KNOWN_FALLBACK).not.toContain(id);
  });
}
