import { useState, useCallback, type Dispatch, type SetStateAction } from "react";
import { getViewState, type SessionViewState } from "../view-state-store";

type Section = "fileView" | "diffView" | "gitView";

/**
 * useState backed by the per-session view-state store: hydrates from the store
 * on mount and writes through on every set. Components using this hook must
 * remount when the session changes (the diff/file routes key their views by
 * session id), so `sessionId` is stable for the lifetime of a hook instance.
 */
export function useViewState<S extends Section, K extends keyof SessionViewState[S]>(
  sessionId: string,
  section: S,
  key: K,
): [SessionViewState[S][K], Dispatch<SetStateAction<SessionViewState[S][K]>>] {
  type V = SessionViewState[S][K];
  const [value, setValue] = useState<V>(() => getViewState(sessionId)[section][key]);
  const set = useCallback<Dispatch<SetStateAction<V>>>(
    (next) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? (next as (p: V) => V)(prev) : next;
        getViewState(sessionId)[section][key] = resolved;
        return resolved;
      });
    },
    [sessionId, section, key],
  );
  return [value, set];
}
