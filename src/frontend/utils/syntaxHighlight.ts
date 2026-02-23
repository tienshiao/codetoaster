import type { SyntaxTokenType } from '../types/diff';
import type { LanguageConfig, CommentStyle } from './languageDetection';

export interface SyntaxToken {
  text: string;
  type: SyntaxTokenType | null;
}

interface TokenPattern {
  type: SyntaxTokenType | null;
  regex: RegExp;
}

function buildPatterns(config: LanguageConfig): TokenPattern[] {
  const patterns: TokenPattern[] = [];
  const isCss = config.name === 'CSS';
  const isSql = config.name === 'SQL';
  const isMarkup = config.name === 'HTML' || config.name === 'XML';

  // Comments - must be checked first
  for (const style of config.commentStyles) {
    if (style === 'c-style') {
      // Single-line comment
      patterns.push({ type: 'comment', regex: /^\/\/[^\n]*/ });
      // Multi-line comment
      patterns.push({ type: 'comment', regex: /^\/\*[\s\S]*?\*\// });
    } else if (style === 'hash') {
      patterns.push({ type: 'comment', regex: /^#[^\n]*/ });
    } else if (style === 'html') {
      patterns.push({ type: 'comment', regex: /^<!--[\s\S]*?-->/ });
    } else if (style === 'sql') {
      // SQL single-line comment
      patterns.push({ type: 'comment', regex: /^--[^\n]*/ });
    }
  }

  // HTML/XML specific patterns
  if (isMarkup) {
    // DOCTYPE
    patterns.push({ type: 'keyword', regex: /^<!DOCTYPE[^>]*>/i });
    // CDATA sections
    patterns.push({ type: 'comment', regex: /^<!\[CDATA\[[\s\S]*?\]\]>/ });
    // Processing instructions like <?xml ... ?>
    patterns.push({ type: 'keyword', regex: /^<\?[\s\S]*?\?>/ });
    // Closing tags </tagname>
    patterns.push({ type: 'keyword', regex: /^<\/[a-zA-Z][a-zA-Z0-9-]*\s*>/ });
    // Opening tags <tagname or self-closing - capture just the tag start
    patterns.push({ type: 'keyword', regex: /^<[a-zA-Z][a-zA-Z0-9-]*/ });
    // Tag end brackets
    patterns.push({ type: 'keyword', regex: /^\/?>/  });
    // Attribute names (before =)
    patterns.push({ type: 'type', regex: /^[a-zA-Z_:][a-zA-Z0-9_:.-]*(?=\s*=)/ });
  }

  // Strings - various quote styles
  // Template literals with backticks
  patterns.push({ type: 'string', regex: /^`(?:[^`\\]|\\.)*`/ });
  // Double-quoted strings
  patterns.push({ type: 'string', regex: /^"(?:[^"\\]|\\.)*"/ });
  // Single-quoted strings
  patterns.push({ type: 'string', regex: /^'(?:[^'\\]|\\.)*'/ });
  // Python triple-quoted strings
  patterns.push({ type: 'string', regex: /^"""[\s\S]*?"""/ });
  patterns.push({ type: 'string', regex: /^'''[\s\S]*?'''/ });

  // CSS hex colors - must come before general numbers
  if (isCss) {
    // Matches #rgb, #rgba, #rrggbb, #rrggbbaa
    patterns.push({ type: 'number', regex: /^#[0-9a-fA-F]{3,8}\b/ });
  }

  // Numbers - hex, binary, octal, floats, scientific notation
  patterns.push({ type: 'number', regex: /^0[xX][0-9a-fA-F]+/ });
  patterns.push({ type: 'number', regex: /^0[bB][01]+/ });
  patterns.push({ type: 'number', regex: /^0[oO][0-7]+/ });
  patterns.push({ type: 'number', regex: /^\d+\.?\d*(?:[eE][+-]?\d+)?/ });
  patterns.push({ type: 'number', regex: /^\.\d+(?:[eE][+-]?\d+)?/ });

  // Operators - multi-char first
  if (!isMarkup) {
    patterns.push({ type: 'operator', regex: /^(?:===|!==|==|!=|<=|>=|&&|\|\||=>|\?\?|\?\.|\.\.\.|<<|>>|>>>|\+\+|--|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|<<=|>>=)/ });
    // Single-char operators
    patterns.push({ type: 'operator', regex: /^[+\-*/%=<>!&|^~?:]/ });
  }

  // Keywords - must be whole words
  if (config.keywords.length > 0) {
    // SQL keywords are case-insensitive
    const flags = isSql ? 'i' : '';
    const keywordPattern = new RegExp(
      `^(?:${config.keywords.join('|')})\\b(?![a-zA-Z0-9_])`,
      flags
    );
    patterns.push({ type: 'keyword', regex: keywordPattern });
  }

  // Type annotations (simplified: word after : or as keyword)
  // This is a heuristic and won't catch all types
  if (!isMarkup) {
    patterns.push({ type: 'type', regex: /^(?::\s*)([A-Z][a-zA-Z0-9_]*)/ });
  }

  // Identifiers - match whole words to prevent partial keyword matches inside words
  // Must come after keywords so keywords get priority
  patterns.push({ type: null, regex: /^[a-zA-Z_][a-zA-Z0-9_]*/ });

  // Punctuation
  patterns.push({ type: 'punctuation', regex: /^[{}[\](),;.]/ });

  return patterns;
}

export function tokenizeLine(line: string, config: LanguageConfig | null): SyntaxToken[] {
  if (!config) {
    return [{ text: line, type: null }];
  }

  const patterns = buildPatterns(config);
  const tokens: SyntaxToken[] = [];
  let remaining = line;
  let plainText = '';

  while (remaining.length > 0) {
    let matched = false;

    for (const pattern of patterns) {
      const match = remaining.match(pattern.regex);
      if (match && match[0]) {
        // Flush accumulated plain text
        if (plainText) {
          tokens.push({ text: plainText, type: null });
          plainText = '';
        }

        tokens.push({ text: match[0], type: pattern.type });
        remaining = remaining.slice(match[0].length);
        matched = true;
        break;
      }
    }

    if (!matched) {
      // Accumulate plain text (identifiers, whitespace, etc.)
      plainText += remaining[0];
      remaining = remaining.slice(1);
    }
  }

  // Flush any remaining plain text
  if (plainText) {
    tokens.push({ text: plainText, type: null });
  }

  return tokens;
}

// Merge adjacent tokens with the same type for cleaner output
export function mergeTokens(tokens: SyntaxToken[]): SyntaxToken[] {
  const merged: SyntaxToken[] = [];
  for (const token of tokens) {
    const last = merged[merged.length - 1];
    if (last && last.type === token.type) {
      last.text += token.text;
    } else {
      merged.push({ ...token });
    }
  }
  return merged;
}
