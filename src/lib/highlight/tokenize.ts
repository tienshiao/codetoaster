import type { SyntaxTokenType, FileTokens, LineTokens } from "../../types/highlight";
import type { GrammarId } from "./assets";
import { grammarForPath } from "./languages";
import { mapCapture } from "./captureMap";
import { runHighlightQuery } from "./registry";
import { getCachedTokens, setCachedTokens } from "./cache";

// Files above these bounds skip tree-sitter and fall back to the client regex
// highlighter (a 1MB parse is ~250ms; beyond that isn't worth blocking on).
export const MAX_CONTENT_LENGTH = 1_000_000;
export const MAX_LINE_COUNT = 50_000;

// Enum used in the paint array: 0 = unstyled, 1..N = index into TOKEN_TYPES + 1.
const TOKEN_TYPES: SyntaxTokenType[] = [
  "keyword", "string", "comment", "number", "operator", "type", "punctuation",
  "function", "variable", "property", "constant", "tag", "attribute",
];
const TYPE_TO_ENUM = new Map<SyntaxTokenType, number>(
  TOKEN_TYPES.map((t, i) => [t, i + 1]),
);
function enumToType(e: number): SyntaxTokenType | null {
  return e === 0 ? null : TOKEN_TYPES[e - 1] ?? null;
}

/**
 * Tokenize `content` with the given grammar into per-line token arrays.
 * Returns null if the grammar is unavailable. Guarantees the reconstruction
 * invariant: `result[i].map(t => t.text).join("") === content.split("\n")[i]`.
 */
export async function highlightContent(
  content: string,
  grammarId: GrammarId,
): Promise<FileTokens | null> {
  const captures = await runHighlightQuery(grammarId, content);
  if (!captures) return null;

  // Paint pass: fill a per-code-unit type array. Captures come ordered by node
  // position with enclosing nodes before nested ones, so painting in order and
  // letting later writes win means the innermost/most-specific capture wins.
  const types = new Uint8Array(content.length);
  for (const cap of captures) {
    const type = mapCapture(cap.name);
    if (type === null) continue;
    const value = TYPE_TO_ENUM.get(type)!;
    types.fill(value, cap.start, cap.end);
  }

  return sliceIntoLines(content, types);
}

function sliceIntoLines(content: string, types: Uint8Array): FileTokens {
  const lines: FileTokens = [];
  let line: LineTokens = [];
  let tokenStart = 0;
  let tokenType = content.length > 0 ? types[0]! : 0;

  const pushToken = (end: number) => {
    if (end > tokenStart) {
      line.push({ text: content.slice(tokenStart, end), type: enumToType(tokenType) });
    }
  };

  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10 /* \n */) {
      pushToken(i);
      lines.push(line);
      line = [];
      tokenStart = i + 1;
      tokenType = i + 1 < content.length ? types[i + 1]! : 0;
    } else if (types[i] !== tokenType) {
      pushToken(i);
      tokenStart = i;
      tokenType = types[i]!;
    }
  }
  pushToken(content.length);
  lines.push(line);
  return lines;
}

/**
 * Grammar lookup + size guard + cache around highlightContent. Returns null when
 * the path has no grammar, the file is too large, or highlighting fails — all of
 * which mean "let the client regex-highlight this".
 */
export async function highlightFile(
  content: string,
  filePath: string,
): Promise<FileTokens | null> {
  const grammarId = grammarForPath(filePath);
  if (!grammarId) return null;
  if (content.length > MAX_CONTENT_LENGTH) return null;

  const cached = getCachedTokens(grammarId, content);
  if (cached !== undefined) return cached;

  let tokens: FileTokens | null = null;
  try {
    // Cheap line-count guard without allocating the full split.
    let lineCount = 1;
    for (let i = 0; i < content.length; i++) {
      if (content.charCodeAt(i) === 10) lineCount++;
    }
    if (lineCount <= MAX_LINE_COUNT) {
      tokens = await highlightContent(content, grammarId);
    }
  } catch (err) {
    console.warn(`[highlight] failed for ${filePath}:`, err);
    tokens = null;
  }

  setCachedTokens(grammarId, content, tokens);
  return tokens;
}
