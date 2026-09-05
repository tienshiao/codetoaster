import { useCallback, useState, type RefObject } from "react";
import { usePulse } from "./use-focus-request";

/**
 * Whether this pane's search bar is up, and the two ways it moves (TASK-58).
 *
 * Search is a per-pane overlay, so the state belongs to the pane and not to the
 * strip: a split renders two terminals, and each has its own bar, its own query
 * and its own matches. Three doors converge here, which is the reason this is a
 * hook rather than three `useState`s copied into `AgentPane` and `ShellPane`:
 *
 *  - ⌘F inside a focused terminal, which xterm's key handler raises as
 *    `onSearchOpen` and which is bound straight to `openSearch`;
 *  - the strip's magnifier, and
 *  - the palette's "Find in terminal" row —
 *
 * the last two arriving as a rising `request`, addressed by tab id the way the
 * focus pulse is, because neither the strip nor the palette can reach into a
 * pane and both have to name *which* pane they mean.
 *
 * `activation` exists because "open" is not the whole gesture. A second ⌘F
 * while the bar is already up is a user reaching for the field again — to
 * retype the query, or because the caret went back to the grid — and a boolean
 * that is already true would make that press do nothing at all. The bar
 * re-focuses and selects its input on every rise of the counter, so pressing
 * the chord twice reads the same as pressing it once.
 *
 * Which is why there is one counter and not a counter beside a boolean: zero is
 * closed, every rise is an activation, and `open` is derived. Two states saying
 * the same thing is two states that can disagree.
 */
export interface TerminalSearch {
  open: boolean;
  /** Increments on every open request, including one arriving while already
   * open — the bar refocuses its input on it. */
  activation: number;
  openSearch: () => void;
  closeSearch: () => void;
}

export function useTerminalSearch(
  terminalRef: RefObject<{ focus(): void } | null>,
  request: number,
): TerminalSearch {
  const [activation, setActivation] = useState(0);
  const open = activation > 0;

  const openSearch = useCallback(() => setActivation((n) => n + 1), []);

  // Closing hands the caret back to the grid (AC #3). Without it the bar
  // unmounts with focus on a removed input and `document.activeElement` falls
  // to `<body>`, so the next keystroke goes nowhere — the user has to click the
  // terminal to carry on typing in the terminal they never left.
  const closeSearch = useCallback(() => {
    setActivation(0);
    terminalRef.current?.focus();
  }, [terminalRef]);

  usePulse(request, openSearch);

  return { open, activation, openSearch, closeSearch };
}
