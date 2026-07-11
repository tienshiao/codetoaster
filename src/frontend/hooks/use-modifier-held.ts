import { useEffect, useState } from "react";

/**
 * True while Cmd (macOS) or Ctrl is held down. Drives the "⌘/Ctrl-click a
 * symbol" affordance in the file and diff views: the code area shows a pointer
 * cursor, teaching the otherwise-hidden go-to-definition gesture. Resets on
 * window blur so the state can't get stuck "held" if the keyup happens while
 * another window is focused.
 */
export function useModifierHeld(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const sync = (e: KeyboardEvent) => setHeld(e.metaKey || e.ctrlKey);
    const clear = () => setHeld(false);
    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
      window.removeEventListener("blur", clear);
    };
  }, []);
  return held;
}
