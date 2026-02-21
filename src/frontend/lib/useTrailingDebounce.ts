import { useState, useEffect, useRef } from "react";

/**
 * Debounces value changes by the given delay. Updates are immediate
 * when the value changes, then held for `delay` ms before accepting
 * the next change. Useful for keeping visual states (animations,
 * indicators) active long enough to be seen.
 */
export function useTrailingDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setDebounced(value), delay);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [value, delay]);

  return debounced;
}
