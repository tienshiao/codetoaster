/** True on macOS/iPadOS, where the primary chord modifier is ⌘ rather than Ctrl. */
export function isMac(): boolean {
  return navigator.platform.toLowerCase().includes("mac");
}

/**
 * True when the page plausibly runs on the daemon's own Mac — the one place
 * Show in Finder means anything, since the daemon reveals the file on its own
 * machine. A desktop Mac (iPadOS reports a Mac platform too, so a touch screen
 * rules it out) that reached the daemon over loopback. A guess, and the server
 * checks the peer address regardless; this only keeps the button off screens
 * where it could never work.
 */
export function canRevealInFinder(): boolean {
  const host = location.hostname;
  const loopback = host === "localhost" || host === "[::1]" || host.startsWith("127.");
  return loopback && isMac() && navigator.maxTouchPoints === 0;
}

/** Display glyph for the go-to-definition modifier: ⌘ on Mac, Ctrl elsewhere. */
export function modifierSymbol(): string {
  return isMac() ? "⌘" : "Ctrl";
}
