import { Parser, Query } from "web-tree-sitter";
import { getGrammar } from "../highlight/registry";
import { TAGS_QUERIES, type SymbolGrammarId } from "./assets";
import type { SymbolEntry, SymbolKind } from "./types";

const MAX_CONTEXT = 200;

// One tags Query per grammar, compiled lazily against the shared (already loaded)
// grammar Language from the highlight registry.
const tagsQueryCache = new Map<SymbolGrammarId, Promise<{ query: Query; parser: Parser } | null>>();

async function getTags(id: SymbolGrammarId): Promise<{ query: Query; parser: Parser } | null> {
  let entry = tagsQueryCache.get(id);
  if (!entry) {
    entry = (async () => {
      const grammar = await getGrammar(id);
      if (!grammar) return null;
      try {
        const query = new Query(grammar.language, TAGS_QUERIES[id]);
        const parser = new Parser();
        parser.setLanguage(grammar.language);
        return { query, parser };
      } catch (err) {
        console.warn(`[symbols] tags query for "${id}" failed to compile:`, err);
        return null;
      }
    })();
    tagsQueryCache.set(id, entry);
  }
  return entry;
}

function symbolKindFor(captureName: string): { kind: "definition" | "reference"; symbolKind: SymbolKind } | null {
  const dot = captureName.indexOf(".");
  if (dot < 0) return null;
  const head = captureName.slice(0, dot);
  const tail = captureName.slice(dot + 1);
  if (head !== "definition" && head !== "reference") return null;
  const known: SymbolKind[] = [
    "function", "method", "class", "interface", "type", "module", "field", "constant", "call",
  ];
  const symbolKind = (known as string[]).includes(tail) ? (tail as SymbolKind) : "function";
  return { kind: head, symbolKind };
}

/**
 * Extract definitions and references from a file. Pure aside from lazily
 * compiling/caching the grammar's tags query. Returns [] if the grammar or its
 * tags query is unavailable.
 */
export async function indexFileContent(
  path: string,
  content: string,
  grammarId: SymbolGrammarId,
): Promise<SymbolEntry[]> {
  const tags = await getTags(grammarId);
  if (!tags) return [];

  const lines = content.split("\n");
  const tree = tags.parser.parse(content)!;
  try {
    const matches = tags.query.matches(tree.rootNode);
    const entries: SymbolEntry[] = [];
    for (const match of matches) {
      const nameCap = match.captures.find((c) => c.name === "name");
      const kindCap = match.captures.find((c) => c.name !== "name");
      if (!nameCap || !kindCap) continue;
      const info = symbolKindFor(kindCap.name);
      if (!info) continue;
      const line = nameCap.node.startPosition.row + 1;
      entries.push({
        name: nameCap.node.text,
        path,
        line,
        kind: info.kind,
        symbolKind: info.symbolKind,
        context: (lines[line - 1] ?? "").trim().slice(0, MAX_CONTEXT),
      });
    }
    return entries;
  } finally {
    tree.delete();
  }
}
