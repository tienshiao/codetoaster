// Resolves the identifier under a click using caret hit-testing. Point-based
// rather than per-token spans so it works identically for server tokens, regex
// fallback tokens, and untyped merged runs — no extra DOM.

const IDENT_CHAR = /[A-Za-z0-9_$]/;
const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

interface CaretPosition {
  node: Node;
  offset: number;
}

function caretFromPoint(x: number, y: number): CaretPosition | null {
  // caretRangeFromPoint (WebKit/Blink) and caretPositionFromPoint (Firefox).
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (doc.caretRangeFromPoint) {
    const range = doc.caretRangeFromPoint(x, y);
    if (range) return { node: range.startContainer, offset: range.startOffset };
  }
  if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos) return { node: pos.offsetNode, offset: pos.offset };
  }
  return null;
}

interface SymbolHit {
  name: string;
  node: Text;
  start: number;
  end: number;
}

// Expands the caret position out to the enclosing identifier, or null if the
// point isn't over one.
function symbolHitAtPoint(x: number, y: number): SymbolHit | null {
  const caret = caretFromPoint(x, y);
  if (!caret || caret.node.nodeType !== Node.TEXT_NODE) return null;
  const node = caret.node as Text;
  const text = node.textContent ?? "";
  let start = caret.offset;
  let end = caret.offset;
  while (start > 0 && IDENT_CHAR.test(text[start - 1]!)) start--;
  while (end < text.length && IDENT_CHAR.test(text[end]!)) end++;
  const name = text.slice(start, end);
  return IDENT_RE.test(name) ? { name, node, start, end } : null;
}

/** Returns the identifier at the given viewport coordinates, or null. */
export function symbolAtPoint(x: number, y: number): string | null {
  return symbolHitAtPoint(x, y)?.name ?? null;
}

/**
 * Like symbolAtPoint, but also returns a Range covering exactly the identifier
 * characters — for underlining the symbol under the cursor (via the Custom
 * Highlight API) without smearing onto surrounding whitespace or wrapper spans.
 */
export function symbolRangeAtPoint(x: number, y: number): { name: string; range: Range } | null {
  const hit = symbolHitAtPoint(x, y);
  if (!hit) return null;
  const range = document.createRange();
  range.setStart(hit.node, hit.start);
  range.setEnd(hit.node, hit.end);
  return { name: hit.name, range };
}
