/** True on macOS/iPadOS, where the primary chord modifier is ⌘ rather than Ctrl. */
export function isMac(): boolean {
  return navigator.platform.toLowerCase().includes("mac");
}

/**
 * True when the browser is on a desktop Mac — the one place Show in Finder
 * means anything, since the daemon reveals the file on its own machine.
 * iPadOS reports a Mac platform too, so a touch screen rules it out.
 */
export function isDesktopMac(): boolean {
  return isMac() && navigator.maxTouchPoints === 0;
}

/** Display glyph for the go-to-definition modifier: ⌘ on Mac, Ctrl elsewhere. */
export function modifierSymbol(): string {
  return isMac() ? "⌘" : "Ctrl";
}
