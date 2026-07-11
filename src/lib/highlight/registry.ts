import { Parser, Language, Query } from "web-tree-sitter";
import { RUNTIME_WASM, GRAMMARS, type GrammarId } from "./assets";

// Lazy, memoized tree-sitter runtime + per-grammar loading.
//
// Grammars are sourced at a modern ABI (web-tree-sitter 0.26.x). A grammar can
// still be individually unusable if its query crashes the capture cursor (some
// grammars with external scanners do this under certain runtime versions), so
// every grammar is smoke-tested once at load and demoted to `null` (client regex
// fallback) if it throws — the tokenizer never has to guard per-call.

export interface LoadedGrammar {
  language: Language;
  query: Query;
}

let initPromise: Promise<void> | null = null;

async function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const wasmBinary = new Uint8Array(await Bun.file(RUNTIME_WASM).arrayBuffer());
      await Parser.init({ wasmBinary });
    })();
  }
  return initPromise;
}

// One shared parser is fine: parsing is synchronous and Bun request handlers
// don't interleave a single parse() call.
let sharedParser: Parser | null = null;

async function getParser(): Promise<Parser> {
  await ensureInit();
  if (!sharedParser) sharedParser = new Parser();
  return sharedParser;
}

const grammarCache = new Map<GrammarId, Promise<LoadedGrammar | null>>();

async function loadGrammar(id: GrammarId): Promise<LoadedGrammar | null> {
  await ensureInit();
  const asset = GRAMMARS[id];
  if (!asset) return null;
  try {
    const bytes = new Uint8Array(await Bun.file(asset.wasm).arrayBuffer());
    const language = await Language.load(bytes);
    const query = new Query(language, asset.highlights);
    // Smoke-test: some grammars crash captures() at runtime; catch it here.
    const parser = new Parser();
    parser.setLanguage(language);
    const tree = parser.parse("")!;
    query.captures(tree.rootNode);
    tree.delete();
    parser.delete();
    return { language, query };
  } catch (err) {
    console.warn(`[highlight] grammar "${id}" unavailable, falling back to regex:`, err);
    return null;
  }
}

export function getGrammar(id: GrammarId): Promise<LoadedGrammar | null> {
  let entry = grammarCache.get(id);
  if (!entry) {
    entry = loadGrammar(id);
    grammarCache.set(id, entry);
  }
  return entry;
}

export interface CaptureRange {
  name: string;
  start: number;
  end: number;
}

/**
 * Parse `content` with a loaded grammar and return capture ranges as plain
 * numbers/strings. Ranges are extracted before the tree is freed so callers
 * never touch a deleted node. Returns null if the grammar is unavailable.
 */
export async function runHighlightQuery(
  id: GrammarId,
  content: string,
): Promise<CaptureRange[] | null> {
  const grammar = await getGrammar(id);
  if (!grammar) return null;
  const parser = await getParser();
  parser.setLanguage(grammar.language);
  const tree = parser.parse(content)!;
  try {
    const captures = grammar.query.captures(tree.rootNode);
    const ranges: CaptureRange[] = new Array(captures.length);
    for (let i = 0; i < captures.length; i++) {
      const c = captures[i]!;
      ranges[i] = { name: c.name, start: c.node.startIndex, end: c.node.endIndex };
    }
    return ranges;
  } finally {
    tree.delete();
  }
}
