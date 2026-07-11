import { toast } from "sonner";
import { modifierSymbol } from "./platform";

// One-time discoverability nudges, gated by localStorage so they show once ever
// (the in-memory view-state store resets on reload, which would re-nag).
const SEEN_PREFIX = "codetoaster:tips:";

/**
 * Surface the ⌘/Ctrl-click go-to-definition gesture the first time the user
 * opens a code file or diff. Self-guards to once ever; whichever view calls it
 * first wins, so callers can fire it unconditionally on content load.
 */
export function maybeShowSymbolTip(): void {
  try {
    const key = `${SEEN_PREFIX}symbol-click`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
  } catch {
    return; // storage blocked (private mode, etc.) → just skip the nudge
  }
  toast(`Tip: ${modifierSymbol()}-click any symbol to find its definition`, {
    duration: 6000,
  });
}
