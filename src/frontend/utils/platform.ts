/** True on macOS/iPadOS, where the primary chord modifier is ⌘ rather than Ctrl. */
export function isMac(): boolean {
  return navigator.platform.toLowerCase().includes("mac");
}

/** Display glyph for the go-to-definition modifier: ⌘ on Mac, Ctrl elsewhere. */
export function modifierSymbol(): string {
  return isMac() ? "⌘" : "Ctrl";
}
