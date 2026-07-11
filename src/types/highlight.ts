// Shared syntax-token types used by both the server (tree-sitter tokenizer)
// and the frontend (render + regex fallback). Keep this module free of any
// server- or frontend-only imports so both trees can depend on it.

export type SyntaxTokenType =
  // Original 7 (produced by the regex fallback in syntaxHighlight.ts)
  | 'keyword'
  | 'string'
  | 'comment'
  | 'number'
  | 'operator'
  | 'type'
  | 'punctuation'
  // Added for tree-sitter's richer captures
  | 'function'
  | 'variable'
  | 'property'
  | 'constant'
  | 'tag'
  | 'attribute';

export interface SyntaxToken {
  text: string;
  type: SyntaxTokenType | null;
}

/** Tokens for a single line, in order; concatenating `text` reconstructs the line. */
export type LineTokens = SyntaxToken[];

/** Tokens for a whole file, indexed by zero-based line number. */
export type FileTokens = LineTokens[];
