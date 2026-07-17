import { useCallback, useRef } from "react";

/**
 * Radix restores focus to a menu/dialog's trigger (or the previously focused
 * element) when it closes — after the exit animation, which lands after any
 * terminal.focus() call and steals focus from a newly entered session. arm()
 * before an action that should end with the terminal focused; the returned
 * onCloseAutoFocus suppresses Radix's restore and focuses the terminal
 * instead. disarm() on overlay open clears an arm whose close was canceled
 * (reopening during the exit animation keeps the content mounted, so
 * onCloseAutoFocus never fires and the arm would leak into the next close).
 */
export function useFocusTerminalOnClose(focusTerminal: () => void) {
  const armedRef = useRef(false);
  const focusTerminalRef = useRef(focusTerminal);
  focusTerminalRef.current = focusTerminal;

  const arm = useCallback(() => {
    armedRef.current = true;
  }, []);
  const disarm = useCallback(() => {
    armedRef.current = false;
  }, []);
  const onCloseAutoFocus = useCallback((e: Event) => {
    if (armedRef.current) {
      armedRef.current = false;
      e.preventDefault();
      focusTerminalRef.current();
    }
  }, []);

  return { arm, disarm, onCloseAutoFocus };
}
