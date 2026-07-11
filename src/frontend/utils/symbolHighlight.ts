// Manages a single CSS Custom Highlight ("symbol-link") that underlines the
// exact identifier under the cursor while a modifier is held — the same idea as
// VSCode's go-to-definition link decoration, but styling an arbitrary Range
// instead of mutating the DOM. No-ops where the Custom Highlight API is
// unavailable; the pointer cursor still signals clickability there.

const HIGHLIGHT_NAME = "symbol-link";

// The Custom Highlight API is newer than the ambient DOM types in use, so type
// just the members we need locally (Highlight is a Set<AbstractRange>, the
// registry a Map<string, Highlight>) rather than depend on lib.dom having them.
interface HighlightLike {
  add(range: Range): void;
  clear(): void;
}
type HighlightConstructor = new (...ranges: Range[]) => HighlightLike;

const HighlightCtor: HighlightConstructor | undefined =
  typeof Highlight !== "undefined" ? (Highlight as unknown as HighlightConstructor) : undefined;
const registry: Map<string, HighlightLike> | undefined =
  typeof CSS !== "undefined" && "highlights" in CSS
    ? (CSS.highlights as unknown as Map<string, HighlightLike>)
    : undefined;

let current: HighlightLike | null = null;

/** Underline exactly `range`, or clear the highlight when passed null. */
export function setSymbolHighlight(range: Range | null): void {
  if (!HighlightCtor || !registry) return;
  if (!range) {
    clearSymbolHighlight();
    return;
  }
  if (!current) {
    current = new HighlightCtor(range);
    registry.set(HIGHLIGHT_NAME, current);
  } else {
    current.clear();
    current.add(range);
  }
}

/** Remove the highlight entirely so the registry reflects "nothing highlighted". */
export function clearSymbolHighlight(): void {
  if (!registry || !current) return;
  registry.delete(HIGHLIGHT_NAME);
  current = null;
}
